/**
 * Bottom sheets. One host element is reused for every sheet, and open sheets
 * form a stack: opening the client picker from inside the job editor puts it
 * on top, and closing it drops back to the editor exactly as it was.
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;
    const Sheets = W.sheets = {};

    let host, panel;
    const stack = [];

    function init() {
        host = document.getElementById('sheetHost');
        panel = U.$('.sheet', host);
    }

    /** Draw whatever is on top of the stack into the host. */
    function paint() {
        const top = stack[stack.length - 1];
        if (!top) return;

        const shell = U.clone('tpl-sheetShell');
        const r = U.roles(shell);
        U.setText(r.title, top.title);
        if (top.sub) {
            U.setText(r.sub, top.sub);
            U.toggle(r.sub, true);
        }
        r.body.appendChild(top.bodyEl);

        U.empty(panel).appendChild(shell);
        r.body.scrollTop = top.scroll || 0;
        top.scroller = r.body;
    }

    /** Push a sheet on top. bodyEl stays alive while it is buried. */
    function open(title, bodyEl, options) {
        if (!host) init();
        const opts = options || {};

        const below = stack[stack.length - 1];
        if (below && below.scroller) below.scroll = below.scroller.scrollTop;

        stack.push({ title: title, bodyEl: bodyEl, sub: opts.sub, onClose: opts.onClose, scroll: 0 });
        paint();

        if (host.hidden) {
            host.hidden = false;
            // next frame, so the slide-in has a starting point to animate from
            requestAnimationFrame(() => host.classList.add('show'));
        }
    }

    /** Drop the top sheet; reveal the one below, or hide the host. */
    Sheets.close = function () {
        if (!stack.length) return;

        const gone = stack.pop();
        if (gone.onClose) gone.onClose();

        if (stack.length) {
            paint();
            return;
        }

        host.classList.remove('show');
        setTimeout(() => {
            if (stack.length) return; // something re-opened meanwhile
            host.hidden = true;
            U.empty(panel);
        }, 260);
    };

    Sheets.isOpen = () => stack.length > 0;

    /* ============================================================
       Plan sheet — pick a day, a start time and a duration
       ============================================================ */
    Sheets.plan = function (jobId, onPlanned) {
        const job = Store.job(jobId);
        if (!job) return;

        const body = U.clone('tpl-planSheet');
        const r = U.roles(body);
        U.setText(r.jobTitle, job.title);
        U.setText(r.planBtnLabel, job.planned ? 'Move it here' : 'Plan it');

        // Start from where the job already sits, else from today.
        let monday = U.mondayOf(job.planned ? U.parseDate(job.planned.date) : new Date());
        let picked = job.planned ? job.planned.date : U.today();

        /* Nothing here is invented. An empty start means "any time that day",
           an empty duration means "no idea yet" — both are allowed to stay
           empty, so a job that is only a title can still be planned. */
        r.start.value = '';
        r.hours.value = '';
        if (job.planned) {
            r.start.value = job.planned.start || '';
            r.hours.value = U.minutesToHours(job.planned.durationMin);
        } else if (job.estimateMin) {
            r.hours.value = U.minutesToHours(job.estimateMin);
        }

        function others() {
            return Store.plannedOn(picked).filter(j => j.id !== job.id);
        }

        function renderDays() {
            U.setText(r.planWeekLabel, U.weekLabel(monday));
            U.empty(r.dayChips);

            U.weekDays(monday).forEach(iso => {
                const chip = U.clone('tpl-dayChip');
                const cr = U.roles(chip);
                U.setText(cr.name, U.dayShort(iso));
                U.setText(cr.date, U.dayOfMonth(iso));

                const booked = Store.plannedOn(iso)
                    .filter(j => j.id !== job.id)
                    .reduce((sum, j) => sum + j.planned.durationMin, 0);
                U.setText(cr.load, booked ? U.duration(booked) : 'free');

                if (iso === U.today()) chip.classList.add('isToday');
                if (iso === picked) chip.classList.add('on');
                chip.addEventListener('click', () => {
                    picked = iso;
                    renderDays();
                    renderPreview();
                });
                r.dayChips.appendChild(chip);
            });
        }

        function renderPreview() {
            const list = others();
            U.empty(r.preview);

            if (!list.length) {
                const row = U.clone('tpl-previewRow');
                row.classList.add('ghost');
                const pr = U.roles(row);
                U.setText(pr.time, '');
                U.setText(pr.title, 'Nothing booked on ' + U.dayName(picked) + ' yet');
                r.preview.appendChild(row);
            } else {
                list.forEach(other => {
                    const row = U.clone('tpl-previewRow');
                    const pr = U.roles(row);
                    U.setText(pr.time, U.slotLabel(other.planned));
                    U.setText(pr.title, other.title);
                    r.preview.appendChild(row);
                });
            }
            checkClash();
        }

        /* A clash is a warning, never a block — a real day has two people on
           it sometimes, and the app should not argue with the dispatcher. */
        function checkClash() {
            const mins = U.hoursToMinutes(r.hours.value);
            // Two jobs can only overlap if both have a time and a length. With
            // either missing there is nothing to compare, so we stay quiet
            // rather than inventing a warning.
            if (!r.start.value || mins == null) {
                U.toggle(r.clash, false);
                return;
            }
            const from = U.toMinutes(r.start.value);
            const to = from + mins;

            const hit = others().find(other => {
                if (!other.planned.start || other.planned.durationMin == null) return false;
                const oFrom = U.toMinutes(other.planned.start);
                const oTo = oFrom + other.planned.durationMin;
                return from < oTo && to > oFrom;
            });

            if (hit) {
                U.setText(r.clashText, 'Overlaps “' + hit.title + '” at ' + hit.planned.start + '. You can still plan it.');
                U.toggle(r.clash, true);
            } else if (to > 24 * 60) {
                U.setText(r.clashText, 'That runs past midnight.');
                U.toggle(r.clash, true);
            } else {
                U.toggle(r.clash, false);
            }
        }

        r.start.addEventListener('input', checkClash);
        r.hours.addEventListener('input', () => {
            r.hours.classList.remove('bad');
            checkClash();
        });

        body.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (!act) return;

            if (act.dataset.act === 'planPrevWeek') { monday = U.addDays(monday, -7); renderDays(); }
            if (act.dataset.act === 'planNextWeek') { monday = U.addDays(monday, 7); renderDays(); }

            if (act.dataset.act === 'confirmPlan') {
                // A day is the whole requirement. Time and length ride along
                // only if the user felt like filling them in.
                Store.planJob(job.id, picked, r.start.value, U.hoursToMinutes(r.hours.value));
                Sheets.close();
                W.app.toast('Planned on ' + U.dayName(picked) + ' ' + U.shortDate(picked));
                if (onPlanned) onPlanned();
            }
        });

        renderDays();
        renderPreview();
        open(job.planned ? 'Move this job' : 'Plan this job', body);
    };

    /* ============================================================
       "Add to this day" — the waiting work, aimed at one date.
       Opened by the + on a day header in My week. Tapping a job
       puts it on that day straight away: no time needed, which
       is the whole point of reaching for this instead of the
       planner.
       ============================================================ */
    Sheets.pickForDay = function (iso, onPlanned) {
        const body = document.createElement('div');
        body.className = 'pickList';

        const waiting = Store.available().slice().sort((a, b) => {
            // urgent first, then whatever is due soonest, then oldest entry
            const rank = p => (p === 'urgent' ? 0 : p === 'high' ? 1 : p === 'normal' ? 2 : 3);
            if (rank(a.priority) !== rank(b.priority)) return rank(a.priority) - rank(b.priority);
            if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
            if (a.deadline && !b.deadline) return -1;
            if (!a.deadline && b.deadline) return 1;
            return a.createdAt.localeCompare(b.createdAt);
        });

        if (!waiting.length) {
            const empty = U.clone('tpl-emptyState');
            const er = U.roles(empty);
            U.setText(er.title, 'Nothing is waiting');
            U.setText(er.sub, 'Everything you have entered is already planned in. Use the red + to add new work.');
            body.appendChild(empty);
        }

        waiting.forEach(job => {
            const row = U.clone('tpl-pickJob');
            const rr = U.roles(row);
            U.setText(rr.title, job.title);

            /* One line of the facts that help you decide, nothing more. */
            const bits = [];
            const client = Store.clientNameOf(job) || Store.locationOf(job);
            if (client) bits.push(client);
            if (job.estimateMin != null) bits.push(U.duration(job.estimateMin));
            const dl = U.deadline(job.deadline);
            if (dl) bits.push(dl.text.toLowerCase());
            U.setText(rr.sub, bits.join(' · '));

            if (job.priority === 'urgent' || job.priority === 'high') {
                U.setText(rr.chip, job.priority);
                rr.chip.classList.add(job.priority);
                U.toggle(rr.chip, true);
            }

            row.addEventListener('click', () => {
                // The estimate rides along as the duration so the day's hours
                // stay useful, but no start time is invented.
                Store.planJob(job.id, iso, null, job.estimateMin);
                Sheets.close();
                W.app.toast('Added to ' + U.dayName(iso));
                if (onPlanned) onPlanned();
            });

            body.appendChild(row);
        });

        open('Add to ' + U.dayName(iso) + ' ' + U.shortDate(iso), body, {
            sub: waiting.length
                ? U.plural(waiting.length, 'job', 'jobs') + ' waiting — tap one to put it on this day'
                : null
        });
    };

    /* ============================================================
       Job sheet — the whole record, editable, with its actions
       ============================================================ */
    Sheets.job = function (jobId, onChanged) {
        const job = Store.job(jobId);
        if (!job) return;

        const body = U.clone('tpl-jobSheet');
        const r = U.roles(body);

        /* chips above the form: when it came in, who typed it, where it sits */
        function renderMeta() {
            const fresh = Store.job(jobId);
            if (!fresh) return;
            U.empty(r.meta);

            const add = (text, tone) => {
                const chip = U.clone('tpl-chip');
                if (tone) chip.classList.add(tone);
                U.setText(U.roles(chip).text, text);
                r.meta.appendChild(chip);
            };

            add(U.age(fresh.createdAt));
            if (fresh.createdBy && fresh.createdBy !== Store.settings().me) add('by ' + fresh.createdBy);

            if (fresh.doneAt) add('Done', 'ok');
        }

        /**
         * The schedule block. Says in words where this job sits and offers the
         * three things you might want to do about it, all above the fold:
         * move it, mark it done, or take it out of the week again.
         */
        function renderActions() {
            const fresh = Store.job(jobId);
            if (!fresh) return;
            const planned = fresh.planned;

            r.sched.classList.toggle('isPlanned', !!planned);
            U.setText(r.schedLabel, planned ? 'In the week' : 'Not in the week yet');

            if (planned) {
                U.setText(r.schedWhen, U.dayName(planned.date) + ' ' + U.shortDate(planned.date) +
                    ' · ' + U.slotLabel(planned).toLowerCase());
            } else {
                U.setText(r.schedWhen, 'Nothing booked yet');
            }

            U.setText(r.replanLabel, planned ? 'Change the day or time' : 'Put it in the week');
            // Planning is the main move on an unplanned job; on one already in
            // the week, changing it is an adjustment, so it steps back a notch.
            r.replanBtn.classList.toggle('primary', !planned);
            r.replanBtn.classList.toggle('outline', !!planned);

            U.setText(r.doneLabel, fresh.doneAt ? 'Not done after all' : 'Mark done');
            U.toggle(r.plannedBtns, !!planned);
        }

        const form = W.jobForm.mount(r.form, job);
        renderMeta();
        renderActions();

        body.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (!act) return;
            const what = act.dataset.act;

            if (what === 'saveJob') {
                if (!form.validate()) return;
                Store.updateJob(jobId, form.read());
                Sheets.close();
                W.app.toast('Saved');
                if (onChanged) onChanged();
            }

            if (what === 'replan') {
                // keep any edits made before reaching for the planner
                if (form.validate()) Store.updateJob(jobId, form.read());
                Sheets.plan(jobId, () => {
                    renderMeta();
                    renderActions();
                    if (onChanged) onChanged();
                });
            }

            if (what === 'toggleDone') {
                Store.setDone(jobId, !Store.job(jobId).doneAt);
                renderMeta();
                renderActions();
                W.app.toast(Store.job(jobId).doneAt ? 'Marked done' : 'Back on the list');
                if (onChanged) onChanged();
            }

            if (what === 'unplan') {
                Store.unplanJob(jobId);
                Sheets.close();
                W.app.toast('Back in Available work');
                if (onChanged) onChanged();
            }

            if (what === 'deleteJob') {
                Sheets.confirm('Delete “' + Store.job(jobId).title + '”? This cannot be undone.', 'Delete it', () => {
                    Store.deleteJob(jobId);
                    Sheets.close();
                    W.app.toast('Deleted');
                    if (onChanged) onChanged();
                });
            }
        });

        open('Job', body);
    };

    /* ============================================================
       Client picker — search the list, or add one by name
       ============================================================ */
    Sheets.clients = function (onPick) {
        const body = U.clone('tpl-clientSheet');
        const r = U.roles(body);
        const newRow = U.$('.newClientRow', body);
        const newName = U.$('[data-role="newName"]', body);

        function render() {
            const typed = r.search.value.trim();
            const q = typed.toLowerCase();
            const all = Store.clients();
            const hits = q ? all.filter(c => c.name.toLowerCase().indexOf(q) >= 0) : all;

            // offer "add this name" unless it is already somebody
            const exact = all.some(c => c.name.toLowerCase() === q);
            U.setText(newName, typed);
            U.toggle(newRow, typed.length > 1 && !exact);

            U.empty(r.list);
            hits.forEach(client => {
                const row = U.clone('tpl-clientRow');
                const cr = U.roles(row);
                U.setText(cr.initials, U.initials(client.name));
                U.setText(cr.name, client.name);

                const count = Store.jobCountFor(client.id);
                U.setText(cr.meta, [client.location, count ? U.plural(count, 'job', 'jobs') : null]
                    .filter(Boolean).join(' · '));

                row.addEventListener('click', () => {
                    Sheets.close();
                    onPick(client);
                });
                r.list.appendChild(row);
            });

            if (!hits.length && !typed) {
                const empty = U.clone('tpl-emptyState');
                const er = U.roles(empty);
                U.setText(er.title, 'No clients yet');
                U.setText(er.sub, 'Type a name above to add the first one.');
                r.list.appendChild(empty);
            }
        }

        newRow.addEventListener('click', () => {
            const name = r.search.value.trim();
            if (!name) return;
            const client = Store.addClient({ name: name });
            Sheets.close();
            W.app.toast('Added ' + client.name);
            onPick(client);
        });

        r.search.addEventListener('input', render);
        render();
        open('Pick a client', body, { sub: 'Or type a name to add a new one' });
        setTimeout(() => r.search.focus(), 320);
    };

    /* ============================================================
       Menu + confirm
       ============================================================ */

    /** rows: [{ label, sub, onPick }] */
    Sheets.menu = function (title, rows) {
        const body = U.clone('tpl-menuSheet');
        const r = U.roles(body);

        rows.forEach(row => {
            const el = U.clone('tpl-menuRow');
            const rr = U.roles(el);
            U.setText(rr.label, row.label);
            U.setText(rr.sub, row.sub || '');
            U.toggle(rr.sub, !!row.sub);
            el.addEventListener('click', row.onPick);
            r.list.appendChild(el);
        });

        open(title, body);
    };

    Sheets.confirm = function (text, yesLabel, onYes) {
        const body = U.clone('tpl-confirmSheet');
        const r = U.roles(body);
        U.setText(r.text, text);
        U.setText(r.yes, yesLabel || 'Yes, do it');

        r.yes.addEventListener('click', () => {
            Sheets.close();
            // let this sheet come off the stack before the callback acts
            setTimeout(onYes, 30);
        });

        open('Are you sure?', body);
    };

}(window));
