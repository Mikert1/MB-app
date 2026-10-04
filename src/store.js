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
    const EMPTY = { version: 2, jobs: [], clients: [], tags: [], settings: { weekHours: 40, me: 'You' } };

    /**
     * Where a job stands with the client. This is the thing that colours a
     * card, so the order here is the order the filters appear in and the
     * colours are the only ones a card ever wears.
     *
     * `tone` names a CSS variable in style.css — never a hex literal.
     */
    const STATUSES = [
        { id: 'available', label: 'Available', tone: '--status-available',
          hint: 'In the pile, nothing agreed yet' },
        { id: 'quote', label: 'Quote', tone: '--status-quote',
          hint: 'A price has gone out, waiting to hear back' },
        { id: 'movable', label: 'Agreed, can move',  tone: '--status-movable',
          hint: 'Talked through, but the day can still shift' },
        { id: 'agreed', label: 'Agreed', tone: '--status-agreed',
          hint: 'Fixed with the client — do not move it' },
        { id: 'done', label: 'Done', tone: '--status-done',
          hint: 'Finished' }
    ];

    /** The palette a custom tag can be given. */
    const TAG_COLOURS = ['red', 'orange', 'amber', 'green', 'teal', 'violet', 'pink', 'grey'];


    let data = null;
    const listeners = [];

    const Store = W.store = {};

    Store.STATUSES = STATUSES;
    Store.TAG_COLOURS = TAG_COLOURS;

    Store.status = function (id) {
        return STATUSES.find(st => st.id === id) || STATUSES[0];
    };

    /** Priority is just a coloured tag on the card now, never a card tint. */
    Store.priorityTone = function (priority) {
        if (priority === 'urgent') return '--prio-urgent';
        if (priority === 'high') return '--prio-high';
        if (priority === 'low') return '--prio-low';
        return null;
    };

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

    /**
     * Brings older stored data up to the current shape instead of discarding
     * it — there is deliberately no reset button, so a tester who started on
     * v1 has to keep everything they entered.
     */
    function migrate(parsed) {
        const out = Object.assign({}, EMPTY, parsed || {});
        out.settings = Object.assign({}, EMPTY.settings, parsed && parsed.settings);
        out.jobs = Array.isArray(out.jobs) ? out.jobs : [];
        out.clients = Array.isArray(out.clients) ? out.clients : [];
        out.tags = Array.isArray(out.tags) ? out.tags : [];

        out.jobs.forEach(job => {
            // v1 had no status: anything already ticked off is done, the rest
            // goes back in the pile as available.
            if (!job.status || !STATUSES.some(st => st.id === job.status)) {
                job.status = job.doneAt ? 'done' : 'available';
            }
            if (!Array.isArray(job.tagIds)) job.tagIds = [];
        });

        // a tag that lost its colour still has to render
        out.tags.forEach(tag => {
            if (TAG_COLOURS.indexOf(tag.color) < 0) tag.color = 'grey';
        });

        out.version = 2;
        return out;
    }

    function save() {
        writeRaw(JSON.stringify(data));
        listeners.forEach(fn => fn());
    }

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
            const parsed = JSON.parse(raw);
            const wasVersion = parsed && parsed.version;
            data = migrate(parsed);
            // Write the upgraded shape straight back. Without this the stored
            // copy stays on the old version until the user happens to change
            // something — and an export taken before that would hand over
            // pre-migration data.
            if (wasVersion !== data.version) save();
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

    /* ---------------- tags ----------------
       Free-form labels the company invents for itself. They carry a colour,
       and a job can wear any number of them. */

    Store.tags = function () {
        return data.tags.slice();
    };

    Store.tag = function (id) {
        return data.tags.find(t => t.id === id) || null;
    };

    Store.tagsOf = function (job) {
        return (job.tagIds || []).map(Store.tag).filter(Boolean);
    };

    Store.addTag = function (fields) {
        const name = String(fields.name || '').trim();
        if (!name) return null;
        const existing = data.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (existing) return existing;

        const tag = {
            id: U.id(),
            name: name,
            color: TAG_COLOURS.indexOf(fields.color) >= 0 ? fields.color : 'grey'
        };
        data.tags.push(tag);
        save();
        return tag;
    };

    /** Deleting a tag also takes it off every job wearing it. */
    Store.deleteTag = function (id) {
        const i = data.tags.findIndex(t => t.id === id);
        if (i < 0) return false;
        data.tags.splice(i, 1);
        data.jobs.forEach(job => {
            if (!job.tagIds) return;
            const at = job.tagIds.indexOf(id);
            if (at >= 0) job.tagIds.splice(at, 1);
        });
        save();
        return true;
    };

    Store.jobCountForTag = function (id) {
        return data.jobs.filter(j => (j.tagIds || []).indexOf(id) >= 0).length;
    };

    /* ---------------- jobs ---------------- */

    function normalise(fields) {
        const known = (fields.tagIds || []).filter(id => data.tags.some(t => t.id === id));
        return {
            title: String(fields.title || '').trim(),
            clientId: fields.clientId || null,
            location: String(fields.location || '').trim(),
            estimateMin: fields.estimateMin == null ? null : Math.max(0, Math.round(fields.estimateMin)),
            deadline: fields.deadline || null,
            priority: ['low', 'normal', 'high', 'urgent'].indexOf(fields.priority) >= 0 ? fields.priority : 'normal',
            status: STATUSES.some(st => st.id === fields.status) ? fields.status : 'available',
            tagIds: known,
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
        // saved straight as done (rare, but allowed) still needs its stamp
        if (job.status === 'done') job.doneAt = new Date().toISOString();
        data.jobs.push(job);
        save();
        return job;
    };

    Store.updateJob = function (id, fields) {
        const job = Store.job(id);
        if (!job) return null;
        Object.assign(job, normalise(fields));
        syncDone(job);
        save();
        return job;
    };

    /** The done status and the doneAt stamp are two views of one fact. */
    function syncDone(job) {
        if (job.status === 'done' && !job.doneAt) job.doneAt = new Date().toISOString();
        if (job.status !== 'done' && job.doneAt) job.doneAt = null;
    }

    Store.setStatus = function (id, status) {
        const job = Store.job(id);
        if (!job || !STATUSES.some(st => st.id === status)) return null;
        job.status = status;
        syncDone(job);
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
        if (job.status === 'done') job.status = 'available';
        save();
        return job;
    };

    Store.setDone = function (id, done) {
        const job = Store.job(id);
        if (!job) return null;
        job.doneAt = done ? new Date().toISOString() : null;
        // ticking a job off is also a status change; unticking sends it back to
        // whatever a planned job normally is rather than to the bottom of the pile
        job.status = done ? 'done' : (job.planned ? 'agreed' : 'available');
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

    /** How many jobs sit in each status, for the Work page's filter chips. */
    Store.statusCounts = function () {
        const counts = {};
        STATUSES.forEach(st => { counts[st.id] = 0; });
        data.jobs.forEach(job => {
            if (counts[job.status] == null) counts[job.status] = 0;
            counts[job.status]++;
        });
        counts.all = data.jobs.length;
        return counts;
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

    /* ---------------- dismissed hints ----------------
       Kept under their own key, not in `data`. Someone who has clicked a tip
       away has said "I know this now" — loading the example work or clearing
       the app must not bring it back. */

    const HINT_KEY = 'workium.hints.v1';

    function hintList() {
        try {
            return (window.localStorage.getItem(HINT_KEY) || '').split(',').filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    Store.hintDismissed = function (name) {
        return hintList().indexOf(name) >= 0;
    };

    Store.dismissHint = function (name) {
        const list = hintList();
        if (list.indexOf(name) >= 0) return;
        list.push(name);
        try {
            window.localStorage.setItem(HINT_KEY, list.join(','));
        } catch (e) {
            console.warn('MB app: could not remember the dismissed hint', e);
        }
    };

    /* ---------------- export ---------------- */

    /**
     * Everything the app has on this device, as one plain object. This is what
     * a tester sends over so their work can be moved onto a real account once
     * there is a backend — so it carries the raw stored values, not a tidied
     * summary, plus enough context to know what produced it.
     */
    Store.exportAll = function () {
        const keys = {};
        try {
            for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i);
                if (key && key.indexOf('workium.') === 0) {
                    keys[key] = window.localStorage.getItem(key);
                }
            }
        } catch (e) {
            console.warn('MB app: could not read localStorage for the export', e);
        }

        return {
            app: 'MB app (demo)',
            exportVersion: 1,
            storeVersion: data.version,
            exportedAt: new Date().toISOString(),
            counts: {
                jobs: data.jobs.length,
                planned: data.jobs.filter(j => j.planned).length,
                done: data.jobs.filter(j => j.doneAt).length,
                clients: data.clients.length,
                tags: data.tags.length
            },
            data: {
                jobs: data.jobs,
                clients: data.clients,
                tags: data.tags,
                settings: data.settings
            },
            rawLocalStorage: keys
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
            // A job's status has to match what the example actually shows:
            // finished work reads "done", booked work reads as agreed unless
            // the row asked for something looser.
            if (done) job.status = 'done';
            else if (planned) job.status = fields.status || 'agreed';
            else job.status = fields.status || 'available';

            if (fields.createdAt) job.createdAt = fields.createdAt;
            if (fields.createdBy) job.createdBy = fields.createdBy;
            return job;
        }

        /* A couple of tags the example company would plausibly have invented,
           so the colours on the cards have something to show. */
        const tagParts = Store.addTag({ name: 'Needs parts', color: 'violet' });
        const tagInvoice = Store.addTag({ name: 'To invoice', color: 'teal' });
        const tagRecurring = Store.addTag({ name: 'Contract', color: 'grey' });

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
            estimateMin: 180, priority: 'normal', createdAt: hoursAgo(24 * 5),
            status: 'movable'
        }, [day(d1), '13:30', 180]);

        make({
            title: 'Shower drain blocked', clientId: c.centraal.id,
            estimateMin: 240, priority: 'high', deadline: U.addDaysIso(todayIso, 2),
            createdAt: hoursAgo(24 * 3)
        }, [day(d2), '08:00', 240]);

        make({
            title: 'Quote visit — full bathroom', clientId: c.devries.id,
            estimateMin: 240, priority: 'normal', createdAt: hoursAgo(24 * 6),
            status: 'movable'
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
                priority: 'normal', createdAt: hoursAgo(-row[0] * 24 + 30),
                tagIds: row[0] > -9 ? [tagInvoice.id] : []
            }, [date, row[4], row[3]], true);
        });

        /* --- waiting, in a spread of statuses --- */
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
            createdAt: hoursAgo(24 * 6), status: 'quote',
            tagIds: [tagParts.id]
        });

        // The hurried one: a title, a client and nothing else.
        const hasty = make({
            title: 'Toilet keeps running', clientId: c.mulder.id,
            priority: 'normal', createdAt: hoursAgo(24 * 4)
        });
        hasty.createdBy = 'Sanne';

        make({
            title: 'Yearly maintenance contract — 8 units', clientId: c.parkzicht.id,
            estimateMin: 960, priority: 'normal', createdAt: hoursAgo(24 * 15),
            status: 'quote', tagIds: [tagRecurring.id]
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
