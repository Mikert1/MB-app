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
            console.warn('Workium: could not save to localStorage', e);
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

    Store.load = function () {
        const raw = readRaw();
        if (!raw) {
            data = migrate(null);
            Store.seed();
            return { fresh: true };
        }
        try {
            data = migrate(JSON.parse(raw));
        } catch (e) {
            console.warn('Workium: stored data was unreadable, starting fresh', e);
            data = migrate(null);
            Store.seed();
            return { fresh: true };
        }
        return { fresh: false };
    };

    Store.onChange = function (fn) {
        listeners.push(fn);
    };

    Store.settings = () => data.settings;

    Store.setWeekHours = function (hours) {
        data.settings.weekHours = Math.max(1, Math.round(hours));
        save();
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

    /** date: 'YYYY-MM-DD', start: 'HH:MM', durationMin: number */
    Store.planJob = function (id, date, start, durationMin) {
        const job = Store.job(id);
        if (!job) return null;
        job.planned = { date: date, start: start, durationMin: Math.max(15, Math.round(durationMin)) };
        // Planning a job is also the moment someone finally knows how long it
        // takes, so an empty estimate gets filled in from what they just booked.
        if (job.estimateMin == null) job.estimateMin = job.planned.durationMin;
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

    /** Jobs planned on a given day, in start order. */
    Store.plannedOn = function (iso) {
        return data.jobs
            .filter(j => j.planned && j.planned.date === iso)
            .sort((a, b) => U.toMinutes(a.planned.start) - U.toMinutes(b.planned.start));
    };

    /** What a hurried entry still lacks — drives the "Incomplete" badge. */
    Store.missingFields = function (job) {
        const missing = [];
        if (job.estimateMin == null) missing.push('estimate');
        if (!job.location && !job.clientId) missing.push('location');
        if (!job.deadline) missing.push('deadline');
        return missing;
    };

    /** A job counts as incomplete when it has no estimate and no deadline. */
    Store.isIncomplete = function (job) {
        return job.estimateMin == null || !job.deadline;
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

        days.forEach(iso => {
            Store.plannedOn(iso).forEach(job => {
                const mins = job.planned.durationMin;
                count++;
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
            target: target,
            free: Math.max(0, target - total),
            over: Math.max(0, total - target)
        };
    };

    /* ---------------- demo data ---------------- */

    /**
     * First-run content, dated relative to today so the week always looks
     * lived-in whenever someone opens the app for the first time.
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
