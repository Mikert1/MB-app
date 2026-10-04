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
       One client: their numbers, their work, their details.
       ============================================================ */

    /** A job as a compact tappable line. */
    function jobLine(job, onChanged) {
        const line = U.clone('tpl-jobLine');
        const lr = U.roles(line);
        U.setText(lr.title, job.title);

        const bits = [];
        if (job.doneAt && job.planned) {
            bits.push(U.shortDate(job.planned.date));
        } else if (job.planned) {
            bits.push(U.dayShort(job.planned.date) + ' ' + U.shortDate(job.planned.date) +
                (job.planned.start ? ' \u00b7 ' + job.planned.start : ''));
        } else {
            bits.push(U.age(job.createdAt).replace('Added ', ''));
        }

        const dl = !job.planned && U.deadline(job.deadline);
        if (dl) bits.push(dl.text.toLowerCase());
        U.setText(lr.sub, bits.join(' \u00b7 '));

        const mins = job.planned && job.planned.durationMin != null
            ? job.planned.durationMin
            : job.estimateMin;
        U.setText(lr.aside, mins == null ? '' : U.duration(mins));

        line.addEventListener('click', () => Sheets.job(job.id, onChanged));
        return line;
    }

    function listBlock(label, jobs, onChanged) {
        const wrap = document.createElement('div');
        if (!jobs.length) return wrap;

        const head = U.clone('tpl-sectionLabel');
        const hr = U.roles(head);
        U.setText(hr.label, label);
        U.setText(hr.aside, U.plural(jobs.length, 'job', 'jobs'));
        wrap.appendChild(head);

        jobs.forEach(job => wrap.appendChild(jobLine(job, onChanged)));
        return wrap;
    }

    Sheets.client = function (clientId, onChanged) {
        const client = Store.client(clientId);
        if (!client) return;

        const body = U.clone('tpl-clientDetail');
        const r = U.roles(body);

        function render() {
            const fresh = Store.client(clientId);
            if (!fresh) return;
            const work = Store.jobsForClient(clientId);

            U.setText(r.statDone, work.done.length);
            U.setText(r.statHours, U.duration(work.minutes) || '0u');
            U.setText(r.statOpen, work.waiting.length + work.planned.length);

            U.setText(r.address, fresh.location || '');
            U.toggle(r.address, !!fresh.location);

            const again = () => { render(); if (onChanged) onChanged(); };
            U.empty(r.lists);
            r.lists.appendChild(listBlock('Waiting to be planned', work.waiting, again));
            r.lists.appendChild(listBlock('In the week', work.planned, again));
            r.lists.appendChild(listBlock('Previous work', work.done, again));

            if (!work.total) {
                const empty = U.clone('tpl-emptyState');
                const er = U.roles(empty);
                U.setText(er.title, 'Nothing for them yet');
                U.setText(er.sub, 'Any job you link to this client shows up here.');
                r.lists.appendChild(empty);
            }

            r.editName.value = fresh.name;
            r.editWhere.value = fresh.location || '';
        }

        r.editName.addEventListener('input', () => {
            r.editName.classList.remove('bad');
            U.toggle(r.nameErr, false);
        });

        body.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (!act) return;

            if (act.dataset.act === 'toggleClientEdit') {
                const opening = r.editWrap.hidden;
                U.toggle(r.editWrap, opening);
                U.$('.detailsToggle', body).classList.toggle('open', opening);
                U.setText(r.editLabel, opening ? 'Leave the details alone' : 'Change name or address');
            }

            if (act.dataset.act === 'saveClient') {
                if (!r.editName.value.trim()) {
                    r.editName.classList.add('bad');
                    U.toggle(r.nameErr, true);
                    r.editName.focus();
                    return;
                }
                Store.updateClient(clientId, { name: r.editName.value, location: r.editWhere.value });
                Sheets.close();
                W.app.toast('Client saved');
                if (onChanged) onChanged();
            }

            if (act.dataset.act === 'addForClient') {
                Sheets.closeAll();
                W.pages.add.startWithClient(clientId);
                W.app.go('add');
            }
        });

        render();
        open(client.name, body, { sub: client.location || null });
    };

    /* ============================================================
       Previous work — everything finished, newest first.
       ============================================================ */
    Sheets.archive = function (onChanged) {
        const body = U.clone('tpl-archiveSheet');
        const r = U.roles(body);

        /** When a finished job happened: its slot if it had one, else when it was ticked off. */
        function whenOf(job) {
            return job.planned ? job.planned.date : U.iso(new Date(job.doneAt));
        }

        function minutesOf(job) {
            if (job.planned && job.planned.durationMin != null) return job.planned.durationMin;
            return job.estimateMin || 0;
        }

        function render() {
            const typed = r.search.value.trim();
            const q = typed.toLowerCase();
            const all = Store.doneJobs();
            const hits = q
                ? all.filter(job => (job.title + ' ' + Store.clientNameOf(job) + ' ' +
                    Store.locationOf(job)).toLowerCase().indexOf(q) >= 0)
                : all;

            U.empty(r.list);

            if (!hits.length) {
                const empty = U.clone('tpl-emptyState');
                const er = U.roles(empty);
                U.setText(er.title, q ? 'Nothing matches that' : 'Nothing finished yet');
                U.setText(er.sub, q
                    ? 'Try a client name or part of the title.'
                    : 'Jobs land here once you mark them done in My week.');
                r.list.appendChild(empty);
                return;
            }

            /* Grouped by month, because "what did we do in September" is the
               question this list exists to answer. */
            const months = [];
            const byMonth = {};
            hits.forEach(job => {
                const key = whenOf(job).slice(0, 7);
                if (!byMonth[key]) { byMonth[key] = []; months.push(key); }
                byMonth[key].push(job);
            });

            months.forEach(key => {
                const jobs = byMonth[key];
                const mins = jobs.reduce((sum, j) => sum + minutesOf(j), 0);

                const head = U.clone('tpl-sectionLabel');
                const hr = U.roles(head);
                U.setText(hr.label, U.monthLabel(whenOf(jobs[0])));
                U.setText(hr.aside, U.plural(jobs.length, 'job', 'jobs') +
                    (mins ? ' \u00b7 ' + U.duration(mins) : ''));
                r.list.appendChild(head);

                jobs.forEach(job => {
                    const line = jobLine(job, () => { render(); if (onChanged) onChanged(); });
                    // in the archive the client matters more than the day of the week
                    const clientName = Store.clientNameOf(job);
                    if (clientName) {
                        U.setText(U.roles(line).sub, U.shortDate(whenOf(job)) + ' \u00b7 ' + clientName);
                    }
                    r.list.appendChild(line);
                });
            });
        }

        r.search.addEventListener('input', render);
        render();

        const count = Store.doneJobs().length;
        open('Previous work', body, {
            sub: count
                ? U.plural(count, 'job', 'jobs') + ' finished \u00b7 ' + U.duration(Store.doneMinutes()) + ' worked'
                : null
        });
    };

    /* ============================================================
       Status — where a job stands with the client. This is what
       colours the card, so picking it is a first-class action.
       ============================================================ */
    Sheets.status = function (current, onPick) {
        const body = U.clone('tpl-statusSheet');
        const r = U.roles(body);

        Store.STATUSES.forEach(st => {
            const row = U.clone('tpl-statusRow');
            const rr = U.roles(row);
            W.chips.paint(rr.dot, st.tone);
            U.setText(rr.label, st.label);
            U.setText(rr.hint, st.hint);
            U.toggle(rr.mark, st.id === current);

            row.addEventListener('click', () => {
                Sheets.close();
                onPick(st.id);
            });
            r.list.appendChild(row);
        });

        open('Status', body, { sub: 'Also sets the colour this job shows up in' });
    };

    /* ============================================================
       Tags — the company's own labels, with their own colours.
       ============================================================ */
    Sheets.tags = function (selectedIds, onChange) {
        const body = U.clone('tpl-tagSheet');
        const r = U.roles(body);
        const chosen = (selectedIds || []).slice();
        let colour = Store.TAG_COLOURS[0];

        function renderList() {
            U.empty(r.list);
            const all = Store.tags();

            if (!all.length) {
                const empty = U.clone('tpl-emptyState');
                const er = U.roles(empty);
                U.setText(er.title, 'No tags yet');
                U.setText(er.sub, 'Make one below — "Needs parts", "To invoice", whatever you sort work by.');
                r.list.appendChild(empty);
                return;
            }

            all.forEach(tag => {
                const row = U.clone('tpl-tagPickRow');
                const rr = U.roles(row);
                W.chips.paint(rr.dot, W.chips.tagTone(tag.color));
                U.setText(rr.name, tag.name);
                U.toggle(rr.mark, chosen.indexOf(tag.id) >= 0);

                row.addEventListener('click', e => {
                    const act = e.target.closest('[data-act]');
                    if (!act) return;

                    if (act.dataset.act === 'toggleTag') {
                        const at = chosen.indexOf(tag.id);
                        if (at >= 0) chosen.splice(at, 1);
                        else chosen.push(tag.id);
                        renderList();
                        onChange(chosen.slice());
                        return;
                    }

                    if (act.dataset.act === 'deleteTag') {
                        const used = Store.jobCountForTag(tag.id);
                        Sheets.confirm(
                            used
                                ? 'Delete the tag “' + tag.name + '”? It comes off ' +
                                  U.plural(used, 'job', 'jobs') + ' as well.'
                                : 'Delete the tag “' + tag.name + '”?',
                            'Delete it',
                            () => {
                                Store.deleteTag(tag.id);
                                const at = chosen.indexOf(tag.id);
                                if (at >= 0) chosen.splice(at, 1);
                                renderList();
                                onChange(chosen.slice());
                                W.app.toast('Tag deleted');
                            }
                        );
                    }
                });

                r.list.appendChild(row);
            });
        }

        function renderSwatches() {
            U.empty(r.swatches);
            Store.TAG_COLOURS.forEach(name => {
                const sw = U.clone('tpl-swatch');
                W.chips.paint(sw, W.chips.tagTone(name));
                sw.classList.toggle('on', name === colour);
                sw.addEventListener('click', () => {
                    colour = name;
                    renderSwatches();
                });
                r.swatches.appendChild(sw);
            });
        }

        r.newName.addEventListener('input', () => {
            r.newName.classList.remove('bad');
            U.toggle(r.newErr, false);
        });

        body.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (!act) return;

            if (act.dataset.act === 'toggleNewTag') {
                const opening = r.newWrap.hidden;
                U.toggle(r.newWrap, opening);
                U.$('.detailsToggle', body).classList.toggle('open', opening);
                U.setText(r.newLabel, opening ? 'Never mind' : 'Make a new tag');
                if (opening) setTimeout(() => r.newName.focus(), 60);
            }

            if (act.dataset.act === 'createTag') {
                const name = r.newName.value.trim();
                if (!name) {
                    r.newName.classList.add('bad');
                    U.toggle(r.newErr, true);
                    r.newName.focus();
                    return;
                }
                const tag = Store.addTag({ name: name, color: colour });
                if (chosen.indexOf(tag.id) < 0) chosen.push(tag.id);
                r.newName.value = '';
                renderList();
                onChange(chosen.slice());
                W.app.toast('Tag “' + tag.name + '” added');
            }
        });

        renderList();
        renderSwatches();
        open('Tags', body, { sub: 'Tap to put a tag on this job, or take it off' });
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
            // Ask for the address while they are thinking about this client,
            // rather than quietly filing a name with nothing attached.
            Sheets.newClient(name, client => {
                if (onPick) onPick(client);
            });
        });

        r.search.addEventListener('input', render);
        render();
        open('Pick a client', body, { sub: 'Or type a name to add a new one' });
        setTimeout(() => r.search.focus(), 320);
    };

    /** The second half of adding a client: their details. */
    Sheets.newClient = function (name, onAdded) {
        const body = U.clone('tpl-newClientSheet');
        const r = U.roles(body);
        r.name.value = name || '';

        r.name.addEventListener('input', () => {
            r.name.classList.remove('bad');
            U.toggle(r.nameErr, false);
        });

        function commit() {
            const typed = r.name.value.trim();
            if (!typed) {
                r.name.classList.add('bad');
                U.toggle(r.nameErr, true);
                r.name.focus();
                return;
            }
            const client = Store.addClient({ name: typed, location: r.where.value });
            Sheets.closeAll();
            W.app.toast(client.name + ' added');
            if (onAdded) onAdded(client);
        }

        r.where.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
        });
        body.addEventListener('click', e => {
            if (e.target.closest('[data-act="saveNewClient"]')) commit();
        });

        open('New client', body);
        setTimeout(() => r.where.focus(), 320);
    };

    /* ============================================================
       Export — the tester's way of handing their work over.
       ============================================================ */
    Sheets.export = function () {
        const body = U.clone('tpl-exportSheet');
        const r = U.roles(body);

        const payload = Store.exportAll();
        const text = JSON.stringify(payload, null, 2);
        const filename = 'mb-app-export-' + U.today() + '.json';
        U.setText(r.filename, filename);

        const stats = U.clone('tpl-statRow');
        const sr = U.roles(stats);
        U.setText(sr.a, payload.counts.jobs);
        U.setText(sr.aLbl, payload.counts.jobs === 1 ? 'job' : 'jobs');
        U.setText(sr.b, payload.counts.clients);
        U.setText(sr.bLbl, payload.counts.clients === 1 ? 'client' : 'clients');
        U.setText(sr.c, Math.max(1, Math.round(text.length / 1024)));
        U.setText(sr.cLbl, 'KB');
        r.stats.appendChild(stats);

        body.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (!act) return;

            if (act.dataset.act === 'downloadExport') {
                try {
                    const blob = new Blob([text], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    // give the browser a moment to start the download first
                    setTimeout(() => URL.revokeObjectURL(url), 2000);
                    W.app.toast('Saved as ' + filename);
                } catch (err) {
                    console.warn('MB app: download failed', err);
                    W.app.toast('This browser blocked the download — use Copy instead');
                }
            }

            if (act.dataset.act === 'copyExport') {
                const done = () => W.app.toast('Copied — paste it into a message');
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done, () => W.app.toast('Could not copy'));
                } else {
                    W.app.toast('Could not copy here — use Download instead');
                }
            }
        });

        open('Export your data', body, { sub: payload.counts.jobs
            ? U.plural(payload.counts.jobs, 'job', 'jobs') + ' and ' +
              U.plural(payload.counts.clients, 'client', 'clients')
            : 'Nothing stored yet' });
    };

    /** Plain words about where the data lives, since there is no account. */
    Sheets.storageInfo = function () {
        const body = document.createElement('div');
        const p = document.createElement('p');
        p.className = 'exportIntro';
        p.textContent = 'This demo has no server. Every job, client and tag you enter is ' +
            'saved in this browser on this device, and it stays there until you clear the ' +
            'browser’s site data. It is not synced, not backed up, and nobody else can see ' +
            'it. Use Export everything to get a copy you can send.';
        body.appendChild(p);
        open('Where this is stored', body);
    };

    /* ============================================================
       Menu + confirm
       ============================================================ */

    /** rows: [{ label, sub, onPick }] */
    /** Drop every open sheet at once — for when a sub-sheet finishes a job. */
    Sheets.closeAll = function () {
        while (Sheets.isOpen()) Sheets.close();
    };

    /* ============================================================
       Week target — a number you type, not one that changes itself
       when you tap it.
       ============================================================ */
    Sheets.weekTarget = function (onSaved) {
        const body = U.clone('tpl-weekTargetSheet');
        const r = U.roles(body);
        r.hours.value = U.minutesToHours(Store.settings().weekHours * 60);

        function commit() {
            // U.hoursToMinutes takes a comma or a dot and rejects junk
            const mins = U.hoursToMinutes(r.hours.value);
            const hours = mins == null ? null : mins / 60;

            if (hours == null || hours > 168) {
                r.hours.classList.add('bad');
                U.toggle(r.err, true);
                r.hours.focus();
                return;
            }
            Store.setWeekHours(hours);
            Sheets.closeAll();
            W.app.toast('A week is now ' + U.minutesToHours(Store.settings().weekHours * 60) + ' hours');
            if (onSaved) onSaved();
        }

        r.hours.addEventListener('input', () => {
            r.hours.classList.remove('bad');
            U.toggle(r.err, false);
        });
        // Enter is how anyone fills in a single-field form
        r.hours.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
        });
        body.addEventListener('click', e => {
            if (e.target.closest('[data-act="saveTarget"]')) commit();
        });

        open('Hours in your week', body);
        setTimeout(() => { r.hours.focus(); r.hours.select(); }, 320);
    };

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
