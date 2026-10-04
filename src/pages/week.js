/** Page 1 — the week you committed to. Opens with today at the top. */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    let section, r, monday, holdScroll = false, pendingScroll = null;

    /* ---------------- a job on a day ---------------- */

    function jobCard(job) {
        const card = U.clone('tpl-weekJob');
        const cr = U.roles(card);
        if (job.doneAt) card.classList.add('isDone');

        // The rail is the job's status: that is the whole colour language now.
        W.chips.paint(cr.rail, Store.status(job.status).tone);

        /* All three shapes of a slot. A job with no clock time gets a dash and
           an "any time" chip, never the words split over two stacked lines. */
        if (job.planned.start) {
            U.setText(cr.start, job.planned.start);
            U.setText(cr.end, job.planned.durationMin == null
                ? '' : U.toClock(U.toMinutes(job.planned.start) + job.planned.durationMin));
        } else {
            card.classList.add('noTime');
            U.setText(cr.start, '—');
            U.setText(cr.end, '');
        }

        U.setText(cr.title, job.title);

        const client = Store.clientNameOf(job);
        const location = Store.locationOf(job);
        U.setText(cr.client, client);
        U.setText(cr.location, location);
        U.toggle(cr.clientWrap, !!client);
        U.toggle(cr.locWrap, !!location);
        U.toggle(cr.sep, !!client && !!location);

        /* The rail already carries the status, so it is not repeated as a chip
           here — only the things the rail cannot say. */
        const extra = [];
        if (!job.planned.start) extra.push(W.chips.plain('Any time'));
        if (job.planned.durationMin != null) extra.push(W.chips.plain(U.duration(job.planned.durationMin)));

        const dl = job.doneAt ? null : U.deadline(job.deadline);
        if (dl && (dl.tone === 'over' || dl.tone === 'accent')) {
            extra.push(W.chips.plain(dl.text, 'accent'));
        }

        W.chips.fill(cr.chips, job, { status: false, extra: extra });

        card.addEventListener('click', () => W.sheets.job(job.id, api.render));
        return card;
    }

    /**
     * "3 jobs · 6u" — and "6u+" when one of them has no duration yet, so the
     * number never quietly under-reports the day.
     */
    function dayLoadLabel(iso) {
        const load = Store.dayLoad(iso);
        const jobs = U.plural(load.count, 'job', 'jobs');
        if (!load.mins) return load.unknown ? jobs : jobs + ' · 0u';
        return jobs + ' · ' + U.duration(load.mins) + (load.unknown ? '+' : '');
    }

    function dayBlock(iso) {
        const block = U.clone('tpl-day');
        const br = U.roles(block);
        const today = U.today();

        if (iso === today) block.classList.add('today');
        else if (iso < today) block.classList.add('past');

        U.setText(br.num, U.dayOfMonth(iso));
        U.setText(br.name, iso === today ? 'Today' : U.dayName(iso));

        const jobs = Store.plannedOn(iso);
        U.setText(br.load, jobs.length ? dayLoadLabel(iso) : 'free');

        if (!jobs.length) {
            br.jobs.appendChild(U.clone('tpl-emptyDay'));
        } else {
            jobs.forEach(job => br.jobs.appendChild(jobCard(job)));
        }

        // both the header's + and the empty-day placeholder read the date here
        block.dataset.date = iso;
        return block;
    }

    /* ---------------- the capacity block ---------------- */

    function capacityCard(days) {
        const card = U.clone('tpl-capacity');
        const cr = U.roles(card);
        const load = Store.weekLoad(days);

        U.setText(cr.planned, (U.duration(load.total) || '0u') + (load.unknown ? '+' : ''));
        U.setText(cr.target, U.duration(load.target));
        U.setText(cr.jobCount, U.plural(load.count, 'job', 'jobs') +
            (load.unknown ? ' · ' + load.unknown + ' untimed' : ''));
        U.setText(cr.freeLabel, load.over ? U.duration(load.over) + ' over' : U.duration(load.free) + ' free');
        U.setText(cr.capUnder, load.over ? 'planned — over your week' : 'planned this week');

        // done, still ahead, and the part spilling past the week's target
        const scale = Math.max(load.target, load.total) || 1;
        const spill = Math.min(load.over, load.ahead);
        cr.barDone.style.width = (load.done / scale * 100) + '%';
        cr.barAhead.style.width = ((load.ahead - spill) / scale * 100) + '%';
        cr.barOver.style.width = (spill / scale * 100) + '%';

        return card;
    }

    /* ---------------- the nudge ---------------- */

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

        // only speak up when there is a reason to
        if (!urgent.length && !overdue.length && !soon.length) return null;

        const card = U.clone('tpl-nudge');
        const nr = U.roles(card);

        if (overdue.length) {
            U.setText(nr.nudgeTitle, U.plural(overdue.length, 'job is', 'jobs are') + ' past their date');
        } else if (urgent.length) {
            U.setText(nr.nudgeTitle, U.plural(urgent.length, 'urgent job', 'urgent jobs') + ' not planned yet');
        } else {
            U.setText(nr.nudgeTitle, U.plural(soon.length, 'job needs', 'jobs need') + ' doing soon');
        }
        U.setText(nr.nudgeSub, 'Tap to see what is waiting');
        return card;
    }

    function sectionLabel(text, aside) {
        const el = U.clone('tpl-sectionLabel');
        const sr = U.roles(el);
        U.setText(sr.label, text);
        U.setText(sr.aside, aside || '');
        return el;
    }

    /* ---------------- scrolling ----------------
       Two jobs here: give the list enough slack past its final day that any
       day can be brought to the top of the screen, then put today there. */

    /* Looks the tail up rather than taking it as an argument: a second render
       can land between scheduling this and running it, and we always want to
       size the tail that is actually on the page. */
    function sizeTail() {
        const tail = U.$('.weekTail', r.weekBody);
        const days = U.$$('.day', r.weekBody);
        const last = days[days.length - 1];
        if (!tail || !last) return;
        /* Just enough that the last day, and nothing more, fills the screen.
           The list's own bottom padding (which keeps content clear of the
           navbar) is scrollable too, so it has to come off the tail — without
           that you scroll a navbar's worth past the last day's header. */
        const padBottom = parseFloat(getComputedStyle(r.weekBody).paddingBottom) || 0;
        const room = r.weekBody.clientHeight - last.offsetHeight - padBottom;
        tail.style.height = Math.max(0, Math.round(room)) + 'px';
    }

    /**
     * Put a day at the top of the list. Returns false when the list has no
     * layout yet — the page is built while #app is still hidden on boot, and
     * every measurement is zero until it is revealed.
     */
    function scrollToDay(iso) {
        const target = U.$('[data-date="' + iso + '"]', r.weekBody);
        if (!target || !r.weekBody.clientHeight) return false;

        const top = target.getBoundingClientRect().top
            - r.weekBody.getBoundingClientRect().top
            + r.weekBody.scrollTop;
        r.weekBody.scrollTop = Math.max(0, top);
        return true;
    }

    /**
     * Keep trying until the list can actually be measured. Without this the
     * one attempt made during boot lands on a zero-height list and silently
     * does nothing.
     */
    function scrollToDaySoon(iso, triesLeft) {
        if (scrollToDay(iso)) {
            pendingScroll = null;
            return;
        }
        if (triesLeft <= 0) return;
        requestAnimationFrame(() => scrollToDaySoon(iso, triesLeft - 1));
    }

    /* ---------------- render ---------------- */

    function render() {
        const days = U.weekDays(monday);
        const today = U.today();
        const isThisWeek = U.iso(monday) === U.iso(U.mondayOf(new Date()));

        U.setText(r.weekLabel, U.weekLabel(monday));
        U.toggle(U.$('[data-act="thisWeek"]', section), !isThisWeek);

        const keepScroll = r.weekBody.scrollTop;
        const body = U.empty(r.weekBody);
        body.appendChild(capacityCard(days));

        const nudge = nudgeCard();
        if (nudge) body.appendChild(nudge);

        if (isThisWeek) {
            const past = days.filter(d => d < today);
            const ahead = days.filter(d => d >= today);
            const load = Store.weekLoad(days);

            /* Days already gone fold away once there is work to look at
               instead — but on an empty week they stay, so the page reads as a
               week you can fill rather than the days that happen to be left. */
            if (past.length && (load.done || !load.count)) {
                body.appendChild(sectionLabel('Earlier this week',
                    load.done ? U.duration(load.done) + ' done' : ''));
                past.forEach(iso => body.appendChild(dayBlock(iso)));
            }
            body.appendChild(sectionLabel('Ahead',
                load.ahead ? U.duration(load.ahead) + ' planned' : ''));
            ahead.forEach(iso => body.appendChild(dayBlock(iso)));
        } else {
            days.forEach(iso => body.appendChild(dayBlock(iso)));
        }

        const tail = document.createElement('div');
        tail.className = 'weekTail';
        body.appendChild(tail);

        /* Boot draws this page twice in quick succession, so each pass has to
           remember its own intent: one that meant to jump to today still
           jumps, even if an earlier callback already did it, and only a pass
           that meant to stay put restores the old position. */
        const wantToday = isThisWeek && !holdScroll;
        if (wantToday) pendingScroll = today;

        // after layout, so the heights are real
        requestAnimationFrame(() => {
            sizeTail();
            if (wantToday) scrollToDaySoon(today, 20);
            else if (pendingScroll) scrollToDaySoon(pendingScroll, 20);
            else r.weekBody.scrollTop = keepScroll;
        });
    }

    const api = {
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

                if (act.dataset.act === 'addToDay') {
                    const day = act.closest('.day');
                    if (!day) return;
                    W.sheets.pickForDay(day.dataset.date, () => {
                        api.render();
                        W.app.refreshBadge();
                        W.pages.work.render();
                    });
                }
            });
        },

        /** Arriving from another page always lands on the live week, at today. */
        show: function () {
            monday = U.mondayOf(new Date());
            holdScroll = false;
            pendingScroll = U.today();
            render();
        },

        /** A re-render caused by an edit keeps the scroll where it is. */
        render: function () {
            holdScroll = true;
            render();
            holdScroll = false;
        }
    };

    W.pages = W.pages || {};
    W.pages.week = api;

}(window));
