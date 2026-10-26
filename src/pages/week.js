/**
 * Page 1 — the week you committed to, as one long list of days.
 *
 * It opens on today. Scrolling up runs back through the days already gone and
 * on into earlier weeks; scrolling down runs into the weeks ahead. Another week
 * is added whenever either end comes into reach, so the list never runs out,
 * and the header always shows the week whose day is at the top of the list.
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    let section, r;
    /* The weeks drawn in the list, as the Monday of the first and of the last. */
    let firstMonday, lastMonday;
    /* What the header is showing: a week, and the day of it at the top. */
    let shownMonday = null, topDay = null;
    /* A day to bring to the top once the list can be measured. Set when
       arriving on the page, cleared as soon as the jump has happened. */
    let pendingJump = null;
    let scrollQueued = false;

    const thisMonday = () => U.mondayOf(new Date());

    /* ---------------- a job on a day ---------------- */

    function jobCard(job) {
        const card = U.clone('tpl-weekJob');
        const cr = U.roles(card);
        if (job.doneAt) card.classList.add('isDone');

        /* The status is the card's main tag: it colours the rail and leads the
           chip row, so the title gets the card's full width. */
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

        const extra = [];
        if (!job.planned.start) extra.push(W.chips.plain('Any time'));
        if (job.planned.durationMin != null) extra.push(W.chips.plain(U.duration(job.planned.durationMin)));

        const dl = job.doneAt ? null : U.deadline(job.deadline);
        if (dl && (dl.tone === 'over' || dl.tone === 'accent')) {
            extra.push(W.chips.plain(dl.text, 'accent'));
        }

        W.chips.fill(cr.chips, job, { extra: extra });

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

        // "Today" replaces the day's name, so the line under it says which day
        const jobs = Store.plannedOn(iso);
        const load = jobs.length ? dayLoadLabel(iso) : 'free';
        U.setText(br.load, iso === today ? U.dayName(iso) + ' · ' + load : load);

        if (jobs.length) {
            jobs.forEach(job => br.jobs.appendChild(jobCard(job)));
        } else if (iso >= today) {
            // An empty day gone by is just its header: scrolling back through
            // weeks of "nothing planned" placeholders would be all noise.
            br.jobs.appendChild(U.clone('tpl-emptyDay'));
        }

        // both the header's + and the empty-day placeholder read the date here
        block.dataset.date = iso;
        return block;
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

    /* ---------------- one week of the list ---------------- */

    /** "6 jobs · 19,5u", with the same "+" as a day when a job has no duration. */
    function weekLoadLabel(load) {
        if (!load.count) return 'nothing planned';
        const jobs = U.plural(load.count, 'job', 'jobs');
        return load.total ? jobs + ' · ' + U.duration(load.total) + (load.unknown ? '+' : '') : jobs;
    }

    /**
     * A label saying which week it is and what it holds, then its seven days.
     * The nudge rides just above today, which is where the page opens, so it
     * is the first thing on screen without hiding yesterday from a scroll up.
     */
    function weekBlock(monday) {
        const block = document.createElement('div');
        block.className = 'weekBlock';
        block.dataset.week = U.iso(monday);

        const days = U.weekDays(monday);
        const today = U.today();
        const isThisWeek = U.iso(monday) === U.iso(thisMonday());

        block.appendChild(sectionLabel(isThisWeek ? 'This week' : U.weekLabel(monday),
            weekLoadLabel(Store.weekLoad(days))));

        days.forEach(iso => {
            if (iso === today) {
                const nudge = nudgeCard();
                if (nudge) block.appendChild(nudge);
            }
            block.appendChild(dayBlock(iso));
        });
        return block;
    }

    /* ---------------- scrolling ---------------- */

    function dayEl(iso) {
        return U.$('.day[data-date="' + iso + '"]', r.weekBody);
    }

    /** Scroll so `el` sits at the very top of the list. */
    function scrollToEl(el) {
        const body = r.weekBody;
        body.scrollTop = Math.max(0, el.getBoundingClientRect().top
            - body.getBoundingClientRect().top + body.scrollTop);
    }

    /** Bring a day to the top — for today, the nudge just above it too. */
    function jumpTo(iso) {
        const day = dayEl(iso);
        if (!day) return false;
        const before = day.previousElementSibling;
        scrollToEl(before && before.classList.contains('nudge') ? before : day);
        return true;
    }

    /**
     * The day whose header is pinned at the top of the list, and how far its
     * top edge sits from the list's. A day with only a sliver left on screen
     * has been scrolled past already.
     */
    function topAnchor() {
        const body = r.weekBody;
        if (!body.clientHeight) return null;
        const top = body.getBoundingClientRect().top;
        const days = U.$$('.day', body);
        for (let i = 0; i < days.length; i++) {
            const rect = days[i].getBoundingClientRect();
            if (rect.bottom > top + 12) return { iso: days[i].dataset.date, offset: rect.top - top };
        }
        return null;
    }

    /** Put a remembered day back at the same height it was before a redraw. */
    function restoreAnchor(keep) {
        const day = dayEl(keep.iso);
        if (!day) return;
        const body = r.weekBody;
        body.scrollTop += day.getBoundingClientRect().top - body.getBoundingClientRect().top - keep.offset;
    }

    /* A week added above pushes everything down, so the scroll moves with it
       and nothing on screen shifts. Done by hand, with the browser's own
       scroll anchoring switched off for this list (see style.css) so the two
       never both correct the same jump. */
    function addWeekAbove() {
        const body = r.weekBody;
        const before = body.scrollHeight;
        firstMonday = U.addDays(firstMonday, -7);
        body.insertBefore(weekBlock(firstMonday), body.firstChild);
        body.scrollTop += body.scrollHeight - before;
    }

    function addWeekBelow() {
        lastMonday = U.addDays(lastMonday, 7);
        r.weekBody.appendChild(weekBlock(lastMonday));
    }

    /**
     * Keep at least a screen of list beyond each end, so a scroll never hits
     * the edge. Capped per call: a list with no height yet would otherwise
     * read as "at the top" forever.
     */
    function fill() {
        const body = r.weekBody;
        const screen = body.clientHeight;
        if (!screen) return;
        for (let i = 0; i < 4 && body.scrollTop < screen; i++) addWeekAbove();
        for (let i = 0; i < 4 && body.scrollHeight - body.scrollTop - screen < screen; i++) addWeekBelow();
    }

    /**
     * The header follows the list: the week at the top, its days in the
     * strip, and the day at the top marked there.
     */
    function updateHeader() {
        const top = topAnchor();
        if (!top) return;

        const monday = U.mondayOf(U.parseDate(top.iso));
        if (!shownMonday || U.iso(monday) !== U.iso(shownMonday)) {
            shownMonday = monday;
            U.setText(r.weekLabel, U.weekLabel(monday));
            renderStrip(U.weekDays(monday), U.today());
            U.toggle(U.$('[data-act="thisWeek"]', section), U.iso(monday) !== U.iso(thisMonday()));
            topDay = null;
        }
        if (top.iso !== topDay) {
            topDay = top.iso;
            U.$$('.stripDay', r.weekStrip).forEach(btn => btn.classList.toggle('atTop', btn.dataset.day === topDay));
        }
    }

    /**
     * Once the list can be measured: make any jump that is waiting (or put
     * the old top day back), top up both ends, and bring the header in line.
     * Retries for a while, because on boot the page is built while #app is
     * still hidden and every measurement is zero until it is revealed.
     */
    function settle(keep, triesLeft) {
        if (!r.weekBody.clientHeight) {
            if (triesLeft > 0) requestAnimationFrame(() => settle(keep, triesLeft - 1));
            return;
        }
        const jumped = pendingJump;
        if (pendingJump) {
            jumpTo(pendingJump);
            pendingJump = null;
        } else if (keep) {
            restoreAnchor(keep);
        }
        fill();
        updateHeader();
        if (jumped) realignAfterFonts(jumped);
    }

    /**
     * On a first visit the list can be laid out before Manrope arrives. When
     * it swaps in, every line above today changes height and today drifts off
     * the top — so jump again then, unless the list was scrolled meanwhile.
     */
    function realignAfterFonts(iso) {
        if (!document.fonts || document.fonts.status === 'loaded') return;
        const landed = r.weekBody.scrollTop;
        document.fonts.ready.then(() => {
            if (Math.abs(r.weekBody.scrollTop - landed) > 1) return;
            jumpTo(iso);
            fill();
            updateHeader();
        });
    }

    /** Scroll to a week, adding weeks until the list reaches it. */
    function goToWeek(monday) {
        while (U.iso(monday) < U.iso(firstMonday)) addWeekAbove();
        while (U.iso(monday) > U.iso(lastMonday)) addWeekBelow();
        const block = U.$('.weekBlock[data-week="' + U.iso(monday) + '"]', r.weekBody);
        if (block) scrollToEl(block);
        fill();
        updateHeader();
    }

    /* ---------------- render ---------------- */

    /**
     * Draw every week the list holds. A redraw after an edit keeps the day at
     * the top where it was; arriving on the page jumps to today instead.
     */
    function render() {
        const keep = pendingJump ? null : topAnchor();
        const body = U.empty(r.weekBody);
        for (let m = firstMonday; U.iso(m) <= U.iso(lastMonday); m = U.addDays(m, 7)) {
            body.appendChild(weekBlock(m));
        }
        // the strip shows the day loads, so it has to redraw with the list
        shownMonday = null;
        requestAnimationFrame(() => settle(keep, 20));
    }

    /**
     * One button per day under the header. The bar is how full the day is
     * against a fifth of the working week, and turns amber past that.
     */
    function renderStrip(days, today) {
        const strip = U.empty(r.weekStrip);
        const dayMins = Store.settings().weekHours * 60 / 5;

        days.forEach(iso => {
            const btn = U.clone('tpl-stripDay');
            const sr = U.roles(btn);
            const load = Store.dayLoad(iso);

            U.setText(sr.name, U.dayShort(iso));
            U.setText(sr.num, U.dayOfMonth(iso));
            btn.dataset.day = iso;
            if (iso === today) btn.classList.add('today');
            else if (iso < today) btn.classList.add('past');
            btn.classList.toggle('over', load.mins > dayMins);
            btn.style.setProperty('--load', Math.min(100, Math.round(load.mins / dayMins * 100)) + '%');
            btn.setAttribute('aria-label', U.dayName(iso) + ' ' + U.shortDate(iso) + ', ' +
                (load.count ? dayLoadLabel(iso) : 'free'));
            strip.appendChild(btn);
        });
    }

    /** The range a fresh visit starts with: last week, this week and next. */
    function resetRange() {
        const monday = thisMonday();
        firstMonday = U.addDays(monday, -7);
        lastMonday = U.addDays(monday, 7);
    }

    const api = {
        init: function (el) {
            section = el;
            r = U.roles(section);
            resetRange();

            section.addEventListener('click', e => {
                const act = e.target.closest('[data-act]');
                if (!act || !section.contains(act)) return;
                const shown = shownMonday || thisMonday();

                if (act.dataset.act === 'prevWeek') goToWeek(U.addDays(shown, -7));
                if (act.dataset.act === 'nextWeek') goToWeek(U.addDays(shown, 7));

                if (act.dataset.act === 'thisWeek') {
                    jumpTo(U.today());
                    fill();
                    updateHeader();
                }

                if (act.dataset.act === 'jumpToDay') {
                    jumpTo(act.dataset.day);
                    fill();
                    updateHeader();
                }

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

            // one pass per frame, however many scroll events arrive in it
            r.weekBody.addEventListener('scroll', () => {
                if (scrollQueued) return;
                scrollQueued = true;
                requestAnimationFrame(() => {
                    scrollQueued = false;
                    fill();
                    updateHeader();
                });
            }, { passive: true });
        },

        /** Arriving from another page always lands on today. */
        show: function () {
            resetRange();
            pendingJump = U.today();
            render();
        },

        /** A re-render caused by an edit keeps the scroll where it is. */
        render: function () {
            render();
        }
    };

    W.pages = W.pages || {};
    W.pages.week = api;

}(window));
