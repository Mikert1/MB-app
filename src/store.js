/**
 * The whole backend of this prototype: one localStorage key, written on
 * every change, read once on boot. Nothing expires — there is no TTL, no
 * session, no cleanup timer anywhere in this file. The tester can close
 * the tab, reboot the machine and come back in a month to the same data.
 * It only ever goes away if they clear site data themselves or use the
 * reset option in the ⋯ menu.
 */
(function (W) {
    'use strict';

    const U = W.util;
    /* The storage keys keep their original name on purpose. Renaming them to
       match the app would orphan the data of anyone already testing, and there
       is deliberately no reset button to recover from that. */
    const KEY = 'workium.store.v1';

    /* The shape we persist. `version` lets a later build migrate instead
       of throwing a tester's data away. */
    const EMPTY = { version: 1, jobs: [], clients: [], settings: { weekHours: 40, me: 'You' } };

    let data = null;
    const listeners = [];

    /* ---------------- persistence ---------------- */

    /** localStorage throws in private mode and when the quota is full. */
    function readRaw() {
        try {
            return window.localStorage.getItem(KEY);
        } catch (e) {
            return null;
        }
    }

    function writeRaw(text) {
        try {
            window.localStorage.setItem(KEY, text);
            return true;
        } catch (e) {
            console.warn('MB app: could not save to localStorage', e);
            return false;
        }
    }

    function migrate(parsed) {
        // Only v1 exists so far. Later versions bump and patch here rather
        // than discarding, so an early tester never loses what they entered.
        const out = Object.assign({}, EMPTY, parsed || {});
        out.settings = Object.assign({}, EMPTY.settings, parsed && parsed.settings);
        out.jobs = Array.isArray(out.jobs) ? out.jobs : [];
        out.clients = Array.isArray(out.clients) ? out.clients : [];
        out.version = 1;
        return out;
    }

    function save() {
        writeRaw(JSON.stringify(data));
        listeners.forEach(fn => fn());
    }

    const Store = W.store = {};

    /** True when this browser lets us keep anything at all. */
    Store.canPersist = function () {
        try {
            const probe = KEY + '.probe';
            window.localStorage.setItem(probe, '1');
            window.localStorage.removeItem(probe);
            return true;
        } catch (e) {
            return false;
        }
    };

    /**
     * A first run starts genuinely empty. It used to drop 28 example jobs in,
     * which was wrong: there is no reset button, so a real tester would have
     * been stuck deleting fake work by hand before they could use the app.
     * Example data is opt-in now — see Store.seed and the ?demo switch in app.js.
     */
    Store.load = function () {
        const raw = readRaw();
        if (!raw) {
            data = migrate(null);
            save();
            return { fresh: true };
        }
        try {
            data = migrate(JSON.parse(raw));
        } catch (e) {
            console.warn('MB app: stored data was unreadable, starting empty', e);
            data = migrate(null);
            save();
            return { fresh: true };
        }
        return { fresh: false };
    };

    Store.onChange = function (fn) {
        listeners.push(fn);
    };

    Store.settings = () => data.settings;

    /**
     * Hours in a working week, as typed by the user. Quarter-hour steps, so a
     * 37,5-hour week works, and refuses anything that is not a sane number
     * rather than silently storing nonsense.
     */
    Store.setWeekHours = function (hours) {
        const n = Number(hours);
        if (!isFinite(n) || n <= 0 || n > 168) return false;
        data.settings.weekHours = Math.round(n * 4) / 4;
        save();
        return true;
    };

    /* ---------------- clients ---------------- */

    Store.clients = function () {
        return data.clients.slice().sort((a, b) => a.name.localeCompare(b.name));
    };

    Store.client = function (id) {
        if (!id) return null;
        return data.clients.find(c => c.id === id) || null;
    };

    Store.addClient = function (fields) {
        const client = {
            id: U.id(),
            name: String(fields.name || '').trim(),
            location: String(fields.location || '').trim()
        };
        data.clients.push(client);
        save();
        return client;
    };

    Store.updateClient = function (id, fields) {
        const client = Store.client(id);
        if (!client) return null;
        const name = String(fields.name || '').trim();
        if (name) client.name = name;
        client.location = String(fields.location || '').trim();
        save();
        return client;
    };

    /** How many jobs this client has on the books, for the picker's subtitle. */
    Store.jobCountFor = function (clientId) {
        return data.jobs.filter(j => j.clientId === clientId).length;
    };

    /* ---------------- jobs ---------------- */

    function normalise(fields) {
        return {
            title: String(fields.title || '').trim(),
            clientId: fields.clientId || null,
            location: String(fields.location || '').trim(),
            estimateMin: fields.estimateMin == null ? null : Math.max(0, Math.round(fields.estimateMin)),
            deadline: fields.deadline || null,
            priority: ['low', 'normal', 'high', 'urgent'].indexOf(fields.priority) >= 0 ? fields.priority : 'normal',
            notes: String(fields.notes || '').trim()
        };
    }

    Store.jobs = () => data.jobs.slice();

    Store.job = function (id) {
        return data.jobs.find(j => j.id === id) || null;
    };

    Store.addJob = function (fields) {
        const job = Object.assign(normalise(fields), {
            id: U.id(),
            createdAt: new Date().toISOString(),
            createdBy: data.settings.me,
            planned: null,
            doneAt: null
        });
        data.jobs.push(job);
        save();
        return job;
    };

    Store.updateJob = function (id, fields) {
        const job = Store.job(id);
        if (!job) return null;
        Object.assign(job, normalise(fields));
        save();
        return job;
    };

    Store.deleteJob = function (id) {
        const i = data.jobs.findIndex(j => j.id === id);
        if (i < 0) return false;
        data.jobs.splice(i, 1);
        save();
        return true;
    };

    /**
     * Put a job on a day. Only the date is needed — `start` and `durationMin`
     * are both allowed to be null, because a title is the only thing this app
     * ever insists on. A job with no time sits at the end of its day as
     * "any time"; a job with no duration simply adds nothing to the hours.
     */
    Store.planJob = function (id, date, start, durationMin) {
        const job = Store.job(id);
        if (!job) return null;

        job.planned = {
            date: date,
            start: start || null,
            durationMin: durationMin == null ? null : Math.max(15, Math.round(durationMin))
        };
        // Booking a slot is often the moment someone finally knows how long it
        // takes, so an empty estimate picks that up — but only if one was given.
        if (job.estimateMin == null && job.planned.durationMin != null) {
            job.estimateMin = job.planned.durationMin;
        }
        save();
        return job;
    };

    Store.unplanJob = function (id) {
        const job = Store.job(id);
        if (!job) return null;
        job.planned = null;
        job.doneAt = null;
        save();
        return job;
    };

    Store.setDone = function (id, done) {
        const job = Store.job(id);
        if (!job) return null;
        job.doneAt = done ? new Date().toISOString() : null;
        save();
        return job;
    };

    /* ---------------- derived views ---------------- */

    /** Jobs with no slot in the week yet — page 2's list. */
    Store.available = function () {
        return data.jobs.filter(j => !j.planned);
    };

    /** Jobs planned on a given day: timed ones in clock order, then the rest. */
    Store.plannedOn = function (iso) {
        return data.jobs
            .filter(j => j.planned && j.planned.date === iso)
            .sort((a, b) => {
                const at = a.planned.start, bt = b.planned.start;
                if (at && bt) return U.toMinutes(at) - U.toMinutes(bt);
                if (at) return -1;   // a time beats no time
                if (bt) return 1;
                return a.createdAt.localeCompare(b.createdAt);
            });
    };

    /**
     * What one day holds: how many jobs, how many minutes of them are known,
     * and whether any had no duration — so a header can say "3 jobs · 6u+"
     * instead of quietly under-reporting.
     */
    Store.dayLoad = function (iso) {
        const jobs = Store.plannedOn(iso);
        let mins = 0;
        let unknown = 0;
        jobs.forEach(job => {
            if (job.planned.durationMin == null) unknown++;
            else mins += job.planned.durationMin;
        });
        return { count: jobs.length, mins: mins, unknown: unknown };
    };

    /**
     * One client's work, split the way the Clients page reads it: what is
     * still waiting, what is booked in, and what has already been done.
     */
    Store.jobsForClient = function (clientId) {
        const mine = data.jobs.filter(j => j.clientId === clientId);
        const byNewestDone = (a, b) => String(b.doneAt).localeCompare(String(a.doneAt));
        const byDay = (a, b) => {
            const d = a.planned.date.localeCompare(b.planned.date);
            if (d !== 0) return d;
            return U.toMinutes(a.planned.start || '99:99') - U.toMinutes(b.planned.start || '99:99');
        };

        const done = mine.filter(j => j.doneAt).sort(byNewestDone);
        const planned = mine.filter(j => j.planned && !j.doneAt).sort(byDay);
        const waiting = mine.filter(j => !j.planned && !j.doneAt)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        // Hours actually worked for this client, which is the number a company
        // wants when it asks "what have we done for them".
        const minutes = done.reduce((sum, j) => {
            if (j.planned && j.planned.durationMin != null) return sum + j.planned.durationMin;
            return sum + (j.estimateMin || 0);
        }, 0);

        return { waiting: waiting, planned: planned, done: done, minutes: minutes, total: mine.length };
    };

    /** Everything finished, newest first — the "previous work" archive. */
    Store.doneJobs = function () {
        return data.jobs.filter(j => j.doneAt)
            .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
    };

    /** Minutes worked across every finished job. */
    Store.doneMinutes = function () {
        return Store.doneJobs().reduce((sum, j) => {
            if (j.planned && j.planned.durationMin != null) return sum + j.planned.durationMin;
            return sum + (j.estimateMin || 0);
        }, 0);
    };

    /** The address to show: the job's own, else the linked client's. */
    Store.locationOf = function (job) {
        if (job.location) return job.location;
        const client = Store.client(job.clientId);
        return client && client.location ? client.location : '';
    };

    Store.clientNameOf = function (job) {
        const client = Store.client(job.clientId);
        return client ? client.name : '';
    };

    /** Hours planned / done / over target for one week, in minutes. */
    Store.weekLoad = function (days) {
        const today = U.today();
        let done = 0;
        let ahead = 0;
        let count = 0;

        let unknown = 0;

        days.forEach(iso => {
            Store.plannedOn(iso).forEach(job => {
                count++;
                const mins = job.planned.durationMin;
                // A job nobody has timed yet still counts as a job, it just
                // cannot add hours to the bar.
                if (mins == null) { unknown++; return; }
                if (job.doneAt || iso < today) done += mins;
                else ahead += mins;
            });
        });

        const target = data.settings.weekHours * 60;
        const total = done + ahead;
        return {
            done: done,
            ahead: ahead,
            total: total,
            count: count,
            unknown: unknown,
            target: target,
            free: Math.max(0, target - total),
            over: Math.max(0, total - target)
        };
    };

    /* ---------------- demo data ---------------- */

    /**
     * The example company, dated relative to today so it always looks
     * lived-in. Never runs on its own: load it with ?demo on the URL, or by
     * calling store.seed() from the console. It replaces whatever is there.
     */
    Store.seed = function () {
        data.jobs = [];
        data.clients = [];

        const c = {};
        [
            ['parkzicht', 'VvE Parkzicht', 'Parklaan 12, 3500 AA Utrecht'],
            ['centraal', 'Hotel Centraal', 'Stationsplein 4, Utrecht'],
            ['vandijk', 'Bakkerij Van Dijk', 'Lange Straat 55, Houten'],
            ['timmer', 'Slagerij Timmer', 'Dorpsstraat 8, Houten'],
            ['veldhuis', 'Kantoor Veldhuis', 'Zonnebaan 120, Utrecht'],
            ['groen', 'Hoveniersbedrijf Groen', 'Industrieweg 3, Nieuwegein'],
            ['dehoek', 'Café De Hoek', 'Markt 1, Houten'],
            ['jansen', 'M. Jansen', 'Beukenlaan 9, Bunnik'],
            ['mulder', 'P. Mulder', 'Kerkweg 23, Odijk'],
            ['devries', 'Fam. De Vries', 'Rijnlaan 88, Utrecht']
        ].forEach(row => {
            c[row[0]] = Store.addClient({ name: row[1], location: row[2] });
        });

        const monday = U.mondayOf(new Date());
        const day = n => U.iso(U.addDays(monday, n));
        const todayIso = U.today();
        const todayOffset = U.daysBetween(day(0), todayIso); // 0..6

        function hoursAgo(h) {
            return new Date(Date.now() - h * 3600000).toISOString();
        }

        function make(fields, planned, done) {
            const job = Store.addJob(fields);
            if (planned) {
                job.planned = { date: planned[0], start: planned[1], durationMin: planned[2] };
                if (done) job.doneAt = new Date(U.parseDate(planned[0]).getTime() + 17 * 3600000).toISOString();
            }
            if (fields.createdAt) job.createdAt = fields.createdAt;
            if (fields.createdBy) job.createdBy = fields.createdBy;
            return job;
        }

        /* --- already planned, earlier in the week --- */
        make({
            title: 'Boiler service — yearly check', clientId: c.parkzicht.id,
            estimateMin: 180, priority: 'normal', createdAt: hoursAgo(24 * 11),
            notes: 'Key is at the caretaker, ask for Ruud.'
        }, [day(0), '08:00', 180], true);

        make({
            title: 'Replace 4 radiator valves', clientId: c.vandijk.id,
            estimateMin: 240, priority: 'normal', createdAt: hoursAgo(24 * 10)
        }, [day(0), '12:00', 240], true);

        make({
            title: 'Bathroom leak — trace & repair', clientId: c.jansen.id,
            estimateMin: 360, priority: 'high', createdAt: hoursAgo(24 * 9)
        }, [day(1), '09:00', 360], true);

        make({
            title: 'Kitchen tap replacement', clientId: c.dehoek.id,
            estimateMin: 240, priority: 'normal', createdAt: hoursAgo(24 * 8)
        }, [day(2), '13:00', 240], true);

        /* --- planned from today onwards --- */
        const d1 = Math.min(todayOffset, 4);
        const d2 = Math.min(todayOffset + 1, 4);

        make({
            title: 'No heating — whole building', clientId: c.parkzicht.id,
            estimateMin: 210, priority: 'urgent', deadline: todayIso,
            createdAt: hoursAgo(26), notes: 'Six flats without heat since yesterday evening.'
        }, [day(d1), '08:30', 210]);

        make({
            title: 'Install 2 outdoor taps', clientId: c.groen.id,
            estimateMin: 180, priority: 'normal', createdAt: hoursAgo(24 * 5)
        }, [day(d1), '13:30', 180]);

        make({
            title: 'Shower drain blocked', clientId: c.centraal.id,
            estimateMin: 240, priority: 'high', deadline: U.addDaysIso(todayIso, 2),
            createdAt: hoursAgo(24 * 3)
        }, [day(d2), '08:00', 240]);

        make({
            title: 'Quote visit — full bathroom', clientId: c.devries.id,
            estimateMin: 240, priority: 'normal', createdAt: hoursAgo(24 * 6)
        }, [day(d2), '13:00', 240]);

        /* --- finished work from earlier weeks, so the Clients page and the
               archive have a history to show on a first run --- */
        [
            [-21, 'parkzicht', 'Boiler service — yearly check', 180, '08:00'],
            [-19, 'centraal', 'Shower mixer replaced, room 12', 120, '09:30'],
            [-18, 'vandijk', 'Oven gas line checked', 90, '13:00'],
            [-15, 'jansen', 'Blocked kitchen drain', 60, '10:00'],
            [-14, 'parkzicht', 'Two radiators bled, flat 3', 90, '14:00'],
            [-12, 'veldhuis', 'Toilet cistern replaced', 120, '08:30'],
            [-11, 'dehoek', 'Dishwasher connection', 150, '11:00'],
            [-8, 'timmer', 'Cold room drain unblocked', 120, '07:30'],
            [-7, 'centraal', 'Yearly check — 14 bathrooms', 480, '08:00'],
            [-5, 'groen', 'Outdoor tap frost valve', 60, '15:00'],
            [-4, 'devries', 'Quote visit — bathroom', 90, '16:00'],
            [-3, 'mulder', 'Leaking washing machine tap', 60, '09:00']
        ].forEach(row => {
            const date = U.addDaysIso(todayIso, row[0]);
            make({
                title: row[2], clientId: c[row[1]].id, estimateMin: row[3],
                priority: 'normal', createdAt: hoursAgo(-row[0] * 24 + 30)
            }, [date, row[4], row[3]], true);
        });

        /* --- waiting in Available work --- */
        make({
            title: 'Water meter leaking in cellar', clientId: c.timmer.id,
            estimateMin: 120, priority: 'urgent', deadline: U.addDaysIso(todayIso, 1),
            createdAt: hoursAgo(2), notes: 'Caller says the floor is already wet.'
        });

        make({
            title: 'Gas smell reported — check line', clientId: c.veldhuis.id,
            estimateMin: 90, priority: 'urgent', deadline: todayIso,
            createdAt: hoursAgo(17)
        });

        make({
            title: 'Replace mixer tap, 3 rooms', clientId: c.centraal.id,
            estimateMin: 300, priority: 'high', deadline: U.addDaysIso(todayIso, 6),
            createdAt: hoursAgo(24 * 6)
        });

        // The hurried one: a title, a client and nothing else.
        const hasty = make({
            title: 'Toilet keeps running', clientId: c.mulder.id,
            priority: 'normal', createdAt: hoursAgo(24 * 4)
        });
        hasty.createdBy = 'Sanne';

        make({
            title: 'Yearly maintenance contract — 8 units', clientId: c.parkzicht.id,
            estimateMin: 960, priority: 'normal', createdAt: hoursAgo(24 * 15)
        });

        make({
            title: 'Call back about garden tap', clientId: c.groen.id,
            estimateMin: 30, priority: 'low', createdAt: hoursAgo(24 * 21)
        });

        make({
            title: 'Radiator cold on first floor', clientId: c.dehoek.id,
            estimateMin: 60, priority: 'normal', deadline: U.addDaysIso(todayIso, 9),
            createdAt: hoursAgo(24 * 2)
        });

        const noClient = make({
            title: 'Someone called about a dripping ceiling — ask for Erik',
            priority: 'high', createdAt: hoursAgo(5)
        });
        noClient.createdBy = 'Sanne';

        save();
    };

    /** Wipe everything, including the demo content. */
    Store.clearAll = function () {
        data = migrate(null);
        save();
    };

}(window));
