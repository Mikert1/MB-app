/** Page 1 — the week you committed to. */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    let section, r, monday;

    function priorityClass(job) {
        if (job.doneAt) return 'isDone';
        if (job.priority === 'urgent') return 'p-urgent';
        if (job.priority === 'high') return 'p-high';
        return '';
    }

    function addChip(host, text, tone) {
        const chip = U.clone('tpl-chip');
        if (tone) chip.classList.add(tone);
        U.setText(U.roles(chip).text, text);
        host.appendChild(chip);
    }

    function jobCard(job) {
        const card = U.clone('tpl-weekJob');
        const cr = U.roles(card);
        const cls = priorityClass(job);
        if (cls) card.classList.add(cls);

        const from = U.toMinutes(job.planned.start);
        U.setText(cr.start, job.planned.start);
        U.setText(cr.end, U.toClock(from + job.planned.durationMin));
        U.setText(cr.title, job.title);

        const client = Store.clientNameOf(job);
        const location = Store.locationOf(job);
        U.setText(cr.client, client);
        U.setText(cr.location, location);
        U.toggle(cr.clientWrap, !!client);
        U.toggle(cr.locWrap, !!location);
        U.toggle(cr.sep, !!client && !!location);

        if (job.doneAt) {
            addChip(cr.chips, 'Done', 'ok');
        } else if (job.priority === 'urgent') {
            addChip(cr.chips, 'Urgent', 'accent');
        } else if (job.priority === 'high') {
            addChip(cr.chips, 'High', 'warn');
        }
        addChip(cr.chips, U.duration(job.planned.durationMin));

        // On the week view a deadline is only worth repeating when it is tight —
        // the job already has a slot, so a date three weeks out is just noise.
        const dl = job.doneAt ? null : U.deadline(job.deadline);
        if (dl && (dl.tone === 'over' || dl.tone === 'accent')) {
            addChip(cr.chips, dl.text, 'accent');
        }

        card.addEventListener('click', () => W.sheets.job(job.id, render));
        return card;
    }

    function dayBlock(iso) {
        const block = U.clone('tpl-day');
        const br = U.roles(block);
        const today = U.today();

        if (iso === today) block.classList.add('today');
        else if (iso < today) block.classList.add('past');

        U.setText(br.num, U.dayOfMonth(iso));
        U.setText(br.name, U.dayName(iso) + (iso === today ? ' · today' : ''));

        const jobs = Store.plannedOn(iso);
        const mins = jobs.reduce((sum, j) => sum + j.planned.durationMin, 0);
        U.setText(br.load, jobs.length ? U.plural(jobs.length, 'job', 'jobs') + ' · ' + U.duration(mins) : 'free');

        if (!jobs.length) {
            br.jobs.appendChild(U.clone('tpl-emptyDay'));
        } else {
            jobs.forEach(job => br.jobs.appendChild(jobCard(job)));
        }
        return block;
    }

    function capacityCard(days) {
        const card = U.clone('tpl-capacity');
        const cr = U.roles(card);
        const load = Store.weekLoad(days);

        U.setText(cr.planned, U.duration(load.total) || '0u');
        U.setText(cr.target, U.duration(load.target));
        U.setText(cr.jobCount, U.plural(load.count, 'job', 'jobs'));
        U.setText(cr.freeLabel, load.over ? U.duration(load.over) + ' over' : U.duration(load.free) + ' free');
        U.setText(cr.capUnder, load.over ? 'planned — over your week' : 'planned this week');

        // Three segments sharing one track: done, still ahead, and the bit
        // that spills past the weekly target.
        const scale = Math.max(load.target, load.total) || 1;
        cr.barDone.style.width = (load.done / scale * 100) + '%';
        cr.barAhead.style.width = (load.ahead / scale * 100) + '%';
        cr.barOver.style.width = '0%';
        if (load.over) {
            // paint the overflow in warning amber at the tail of the bar; the
            // spill can be wider than the "ahead" block when the done hours
            // alone already passed the target, so clamp instead of going negative
            const spill = Math.min(load.over, load.ahead);
            cr.barAhead.style.width = ((load.ahead - spill) / scale * 100) + '%';
            cr.barOver.style.width = (spill / scale * 100) + '%';
        }

        U.setText(cr.legendDone, U.duration(load.done) || '0u');
        U.setText(cr.legendAhead, U.duration(load.ahead) || '0u');
        U.setText(cr.legendFree, U.duration(load.free) || '0u');
        U.setText(cr.legendOver, U.duration(load.over) || '0u');
        U.toggle(cr.legendFreeWrap, !load.over);
        U.toggle(cr.legendOverWrap, !!load.over);

        return card;
    }

    function nudgeCard() {
        const waiting = Store.available();
        if (!waiting.length) return null;

        const urgent = waiting.filter(j => j.priority === 'urgent');
        const overdue = waiting.filter(j => j.deadline && U.daysBetween(U.today(), j.deadline) < 0);
        const soon = waiting.filter(j => {
            if (!j.deadline) return false;
            const days = U.daysBetween(U.today(), j.deadline);
            return days >= 0 && days <= 1;
        });

        // Only shout when there is a reason to; otherwise stay quiet.
        if (!urgent.length && !overdue.length && !soon.length) return null;

        const card = U.clone('tpl-nudge');
        const nr = U.roles(card);

        if (overdue.length) {
            U.setText(nr.nudgeTitle, U.plural(overdue.length, 'job is', 'jobs are') + ' past their deadline');
        } else if (urgent.length) {
            U.setText(nr.nudgeTitle, U.plural(urgent.length, 'urgent job', 'urgent jobs') + ' unplanned');
        } else {
            U.setText(nr.nudgeTitle, U.plural(soon.length, 'deadline', 'deadlines') + ' coming up');
        }

        if (soon.length) {
            const next = soon.sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
            const days = U.daysBetween(U.today(), next.deadline);
            U.setText(nr.nudgeSub, 'One deadline is ' + (days === 0 ? 'today' : 'tomorrow'));
        } else {
            U.setText(nr.nudgeSub, U.plural(waiting.length, 'job', 'jobs') + ' waiting in Available work');
        }

        return card;
    }

    function render() {
        const days = U.weekDays(monday);
        const today = U.today();
        const thisMonday = U.iso(U.mondayOf(new Date()));
        const isThisWeek = U.iso(monday) === thisMonday;

        U.setText(r.weekLabel, U.weekLabel(monday));
        U.toggle(U.$('[data-act="thisWeek"]', section), !isThisWeek);

        const body = U.empty(r.weekBody);
        body.appendChild(capacityCard(days));

        const nudge = nudgeCard();
        if (nudge) body.appendChild(nudge);

        if (isThisWeek) {
            // This week reads as two halves: what is behind you, dimmed, and
            // what is still coming. Other weeks are just seven days.
            const past = days.filter(d => d < today);
            const ahead = days.filter(d => d >= today);
            const load = Store.weekLoad(days);

            if (past.length && load.done) {
                body.appendChild(sectionLabel('Earlier this week', U.duration(load.done) + ' done'));
                past.forEach(iso => body.appendChild(dayBlock(iso)));
            }
            body.appendChild(sectionLabel('Ahead', U.duration(load.ahead) + ' planned'));
            ahead.forEach(iso => body.appendChild(dayBlock(iso)));
        } else {
            days.forEach(iso => body.appendChild(dayBlock(iso)));
        }
    }

    function sectionLabel(text, aside) {
        const el = U.clone('tpl-sectionLabel');
        const sr = U.roles(el);
        U.setText(sr.label, text);
        U.setText(sr.aside, aside || '');
        return el;
    }

    W.pages = W.pages || {};
    W.pages.week = {
        init: function (el) {
            section = el;
            r = U.roles(section);
            monday = U.mondayOf(new Date());

            section.addEventListener('click', e => {
                const act = e.target.closest('[data-act]');
                if (!act || !section.contains(act)) return;

                if (act.dataset.act === 'prevWeek') { monday = U.addDays(monday, -7); render(); }
                if (act.dataset.act === 'nextWeek') { monday = U.addDays(monday, 7); render(); }
                if (act.dataset.act === 'thisWeek') { monday = U.mondayOf(new Date()); render(); }
                if (act.dataset.act === 'demoMenu') W.app.demoMenu();
            });
        },

        /** Jumping here from elsewhere should always land on the live week. */
        show: function () {
            monday = U.mondayOf(new Date());
            render();
        },

        render: render
    };

}(window));
