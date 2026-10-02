/** Page 2 — the pile of pending work you plan from. */
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

    let section, r, filter = 'all', sortIndex = 0, query = '';

    /* ---------------- filtering & sorting ---------------- */

    function matchesFilter(job, which) {
        if (which === 'urgent') return job.priority === 'urgent';
        if (which === 'incomplete') return Store.isIncomplete(job);
        if (which === 'week') {
            if (!job.deadline) return false;
            const days = U.daysBetween(U.today(), job.deadline);
            return days <= 7; // includes anything already overdue
        }
        return true;
    }

    function matchesQuery(job) {
        if (!query) return true;
        const haystack = [job.title, Store.clientNameOf(job), Store.locationOf(job), job.notes]
            .join(' ').toLowerCase();
        return haystack.indexOf(query) >= 0;
    }

    function sorted(jobs) {
        const sort = SORTS[sortIndex].key;
        return jobs.slice().sort((a, b) => {
            // Urgent always rides on top, whatever the sort — that is the point
            // of marking something urgent in the first place.
            const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            if (a.priority === 'urgent' || b.priority === 'urgent') {
                if (rank !== 0) return rank;
            }

            if (sort === 'deadline') {
                if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
                if (a.deadline) return -1;
                if (b.deadline) return 1;
            }
            if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt);
            return a.createdAt.localeCompare(b.createdAt);
        });
    }

    /* ---------------- cards ---------------- */

    function addChip(host, text, tone) {
        const chip = U.clone('tpl-chip');
        if (tone) chip.classList.add(tone);
        U.setText(U.roles(chip).text, text);
        host.appendChild(chip);
    }

    function card(job) {
        const el = U.clone('tpl-availCard');
        const cr = U.roles(el);

        if (job.priority === 'urgent') el.classList.add('p-urgent');
        if (job.priority === 'high') el.classList.add('p-high');

        U.setText(cr.title, job.title);
        U.setText(cr.prio, job.priority);
        cr.prio.classList.toggle('urgent', job.priority === 'urgent');
        cr.prio.classList.toggle('high', job.priority === 'high');

        const client = Store.clientNameOf(job);
        const location = Store.locationOf(job);
        U.setText(cr.client, client);
        U.setText(cr.location, location);
        U.toggle(cr.clientWrap, !!client);
        U.toggle(cr.locWrap, !!location);
        U.toggle(cr.sep, !!client && !!location);

        if (job.estimateMin != null) addChip(cr.chips, U.duration(job.estimateMin));
        const dl = U.deadline(job.deadline);
        if (dl) {
            const tone = (dl.tone === 'over' || dl.tone === 'accent') ? 'accent'
                : dl.tone === 'warn' ? 'warn' : '';
            addChip(cr.chips, dl.text, tone);
        } else {
            addChip(cr.chips, 'No deadline', 'ghost');
        }

        const missing = Store.missingFields(job);
        if (missing.length) {
            U.setText(cr.missing, missing.join(', '));
            U.toggle(cr.incomplete, true);
        }

        const age = U.age(job.createdAt);
        const by = job.createdBy && job.createdBy !== Store.settings().me ? ' by ' + job.createdBy : '';
        U.setText(cr.age, age + by);

        // A job that is still missing its basics gets a different first move:
        // finish it, rather than squeeze a guess into the week.
        if (missing.length >= 2) {
            U.setText(cr.plan, 'Complete');
            cr.plan.classList.add('quiet');
            cr.plan.dataset.act = 'open';
        }

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

    function render() {
        const all = Store.available();

        // counts on the chips always describe the whole pile, not the search
        U.$$('.fchip', r.filters).forEach(chip => {
            const which = chip.dataset.filter;
            const count = all.filter(j => matchesFilter(j, which)).length;
            U.setText(U.$('.cnt', chip), count);
            chip.classList.toggle('on', which === filter);
        });

        const totalMins = all.reduce((sum, j) => sum + (j.estimateMin || 0), 0);
        U.setText(r.availSub, all.length
            ? U.plural(all.length, 'job', 'jobs') + ' waiting' + (totalMins ? ' · ' + U.duration(totalMins) + ' of work' : '')
            : 'Nothing waiting — the week is yours');

        U.setText(r.sortLabel, SORTS[sortIndex].label);

        const shown = sorted(all.filter(j => matchesFilter(j, filter) && matchesQuery(j)));
        const list = U.empty(r.availList);

        if (!shown.length) {
            const empty = U.clone('tpl-emptyState');
            const er = U.roles(empty);
            if (query) {
                U.setText(er.title, 'Nothing matches “' + query + '”');
                U.setText(er.sub, 'Try a client name or part of the title.');
            } else if (filter !== 'all') {
                U.setText(er.title, 'Nothing in this filter');
                U.setText(er.sub, 'Tap All to see everything that is waiting.');
            } else if (!Store.jobs().length) {
                U.setText(er.title, 'No work yet');
                U.setText(er.sub, 'Tap the red + to add the first job.');
            } else {
                U.setText(er.title, 'Everything is planned');
                U.setText(er.sub, 'Nothing is sitting in the pile. Check My week to see where it all landed.');
            }
            list.appendChild(empty);
            return;
        }

        shown.forEach(job => list.appendChild(card(job)));
    }

    W.pages = W.pages || {};
    W.pages.avail = {
        init: function (el) {
            section = el;
            r = U.roles(section);

            r.filters.addEventListener('click', e => {
                const chip = e.target.closest('.fchip');
                if (!chip) return;
                filter = chip.dataset.filter;
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
                    const open = r.searchWrap.hidden;
                    U.toggle(r.searchWrap, open);
                    if (open) r.search.focus();
                    else clearSearch();
                }
                if (act.dataset.act === 'clearSearch') clearSearch();
            });
        },

        show: render,
        render: render
    };

    function clearSearch() {
        r.search.value = '';
        query = '';
        render();
    }

}(window));
