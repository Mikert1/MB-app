/**
 * Page 2 — all the work, filtered by where it stands.
 *
 * This used to be "Available work" and only ever showed unplanned jobs. It
 * shows everything now, with one chip per status and Available selected when
 * you arrive — so the common view is unchanged, but the rest is one tap away
 * instead of invisible.
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
    const SORTS = [
        { key: 'oldest', label: 'oldest first' },
        { key: 'newest', label: 'newest first' },
        { key: 'deadline', label: 'deadline first' }
    ];

    let section, r, filter = 'available', sortIndex = 0, query = '';

    /* ---------------- filtering & sorting ---------------- */

    function matchesFilter(job) {
        if (filter === 'all') return true;
        return job.status === filter;
    }

    function matchesQuery(job) {
        if (!query) return true;
        return [job.title, Store.clientNameOf(job), Store.locationOf(job), job.notes]
            .join(' ').toLowerCase().indexOf(query) >= 0;
    }

    function sorted(jobs) {
        const sort = SORTS[sortIndex].key;
        return jobs.slice().sort((a, b) => {
            // Urgent rides on top whatever the sort — that is the point of
            // calling something urgent in the first place.
            const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            if ((a.priority === 'urgent' || b.priority === 'urgent') && rank !== 0) return rank;

            if (sort === 'deadline') {
                if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
                if (a.deadline && !b.deadline) return -1;
                if (!a.deadline && b.deadline) return 1;
            }
            if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
            return a.createdAt.localeCompare(b.createdAt);
        });
    }

    /* ---------------- the card ---------------- */

    function card(job) {
        const el = U.clone('tpl-workCard');
        const cr = U.roles(el);

        const status = Store.status(job.status);
        W.chips.paint(cr.rail, status.tone);
        W.chips.paint(cr.statusChip, status.tone);
        U.setText(cr.statusText, status.label);
        U.setText(cr.title, job.title);

        const client = Store.clientNameOf(job);
        const location = Store.locationOf(job);
        U.setText(cr.client, client);
        U.setText(cr.location, location);
        U.toggle(cr.clientWrap, !!client);
        U.toggle(cr.locWrap, !!location);
        U.toggle(cr.sep, !!client && !!location);

        /* Facts the chips above cannot carry. No "no deadline" chip: most work
           never gets one, so saying so on every card is pure noise. */
        const extra = [];
        if (job.estimateMin != null) extra.push(W.chips.plain(U.duration(job.estimateMin)));

        const dl = U.deadline(job.deadline);
        if (dl) {
            const tone = (dl.tone === 'over' || dl.tone === 'accent') ? 'accent'
                : dl.tone === 'warn' ? 'warn' : '';
            extra.push(W.chips.plain(dl.text, tone));
        }
        if (job.planned) {
            extra.push(W.chips.plain(U.dayShort(job.planned.date) + ' ' +
                U.shortDate(job.planned.date) +
                (job.planned.start ? ' · ' + job.planned.start : '')));
        }

        // status: false — it already has the corner to itself
        W.chips.fill(cr.chips, job, { status: false, extra: extra });

        const age = U.age(job.createdAt);
        const by = job.createdBy && job.createdBy !== Store.settings().me ? ' by ' + job.createdBy : '';
        U.setText(cr.age, age + by);

        // A job already in the week gets "Move" rather than a second "Plan".
        U.setText(cr.plan, job.planned ? 'Move' : 'Plan');
        cr.plan.classList.toggle('quiet', !!job.planned);

        el.addEventListener('click', e => {
            const act = e.target.closest('[data-act]');
            if (!act) return;
            if (act.dataset.act === 'plan') W.sheets.plan(job.id, afterChange);
            if (act.dataset.act === 'open') W.sheets.job(job.id, afterChange);
        });

        return el;
    }

    function afterChange() {
        render();
        W.app.refreshBadge();
        W.pages.week.render();
    }

    /* ---------------- render ---------------- */

    function renderFilters() {
        const counts = Store.statusCounts();
        U.empty(r.filters);

        const add = (id, label, count, tone) => {
            const chip = document.createElement('button');
            chip.className = 'fchip';
            chip.dataset.filter = id;
            chip.classList.toggle('on', id === filter);
            chip.appendChild(document.createTextNode(label));

            const cnt = document.createElement('span');
            cnt.className = 'cnt';
            cnt.textContent = count;
            chip.appendChild(cnt);

            // the chip wears its status colour when it is the active one
            if (tone && id === filter) chip.style.setProperty('--tone', W.chips.tone(tone));
            if (tone && id === filter) chip.classList.add('toned');

            r.filters.appendChild(chip);
        };

        Store.STATUSES.forEach(st => add(st.id, st.label, counts[st.id] || 0, st.tone));
        add('all', 'All', counts.all || 0, null);
    }

    function render() {
        renderFilters();

        const all = Store.jobs().filter(matchesFilter);
        const openMins = all.reduce((sum, j) => sum + (j.estimateMin || 0), 0);
        const label = filter === 'all' ? 'in total' : Store.status(filter).label.toLowerCase();
        U.setText(r.workSub, all.length
            ? U.plural(all.length, 'job', 'jobs') + ' ' + label + (openMins ? ' · ' + U.duration(openMins) : '')
            : 'Nothing here');

        U.setText(r.sortLabel, SORTS[sortIndex].label);

        const shown = sorted(all.filter(matchesQuery));
        const list = U.empty(r.workList);

        if (!shown.length) {
            const empty = U.clone('tpl-emptyState');
            const er = U.roles(empty);
            if (query) {
                U.setText(er.title, 'Nothing matches “' + query + '”');
                U.setText(er.sub, 'Try a client name or part of the title.');
            } else if (!Store.jobs().length) {
                U.setText(er.title, 'No work yet');
                U.setText(er.sub, 'Tap the red + below to add the first job.');
            } else {
                U.setText(er.title, 'Nothing ' + label);
                U.setText(er.sub, 'Tap another chip above to see the rest of the work.');
            }
            list.appendChild(empty);
            return;
        }

        shown.forEach(job => list.appendChild(card(job)));
    }

    function clearSearch() {
        r.search.value = '';
        query = '';
        render();
    }

    W.pages = W.pages || {};
    W.pages.work = {
        init: function (el) {
            section = el;
            r = U.roles(section);

            r.filters.addEventListener('click', e => {
                const chip = e.target.closest('.fchip');
                if (!chip) return;
                filter = chip.dataset.filter;
                r.workBody.scrollTop = 0;
                render();
            });

            r.search.addEventListener('input', () => {
                query = r.search.value.trim().toLowerCase();
                render();
            });

            section.addEventListener('click', e => {
                const act = e.target.closest('[data-act]');
                if (!act || !section.contains(act)) return;

                if (act.dataset.act === 'sort') {
                    sortIndex = (sortIndex + 1) % SORTS.length;
                    render();
                }
                if (act.dataset.act === 'toggleSearch') {
                    const opening = r.searchWrap.hidden;
                    U.toggle(r.searchWrap, opening);
                    if (opening) r.search.focus();
                    else clearSearch();
                }
                if (act.dataset.act === 'clearSearch') clearSearch();
            });
        },

        /** Arriving from elsewhere always starts on Available. */
        show: function () {
            render();
        },

        render: render,

        /** The nudge on My week sends people here to deal with urgent work. */
        showAvailable: function () {
            filter = 'available';
            render();
        }
    };

}(window));
