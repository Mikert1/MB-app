/**
 * Page 4 — clients, and everything already done for them.
 *
 * Two things live here: the list of clients, and the archive of finished work.
 * Jobs leave the week once it has passed, so this is the only place that still
 * knows what the company actually did — which is what makes it worth a tab.
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    let section, r, query = '';

    function matches(client) {
        if (!query) return true;
        return (client.name + ' ' + (client.location || '')).toLowerCase().indexOf(query) >= 0;
    }

    function clientCard(client) {
        const card = U.clone('tpl-clientCard');
        const cr = U.roles(card);
        const work = Store.jobsForClient(client.id);

        U.setText(cr.initials, U.initials(client.name));
        U.setText(cr.name, client.name);
        U.setText(cr.where, client.location || '');
        U.toggle(cr.where, !!client.location);

        /* The line underneath is the client's history in three numbers; an
           empty client says so rather than showing three zeroes. */
        if (!work.total) {
            U.setText(cr.stats, 'No work yet');
        } else {
            const bits = [];
            if (work.done.length) bits.push(U.plural(work.done.length, 'job', 'jobs') + ' done');
            if (work.minutes) bits.push(U.duration(work.minutes) + ' worked');
            if (work.planned.length) bits.push(work.planned.length + ' in the week');
            U.setText(cr.stats, bits.join(' · ') || U.plural(work.total, 'job', 'jobs'));
        }

        const open = work.waiting.length;
        U.setText(cr.openCount, open);
        U.toggle(cr.openCount, open > 0);

        card.addEventListener('click', () => W.sheets.client(client.id, render));
        return card;
    }

    function sectionLabel(text, aside) {
        const el = U.clone('tpl-sectionLabel');
        const sr = U.roles(el);
        U.setText(sr.label, text);
        U.setText(sr.aside, aside || '');
        return el;
    }

    function render() {
        const all = Store.clients();
        const doneCount = Store.doneJobs().length;

        U.setText(r.clientsSub, all.length
            ? U.plural(all.length, 'client', 'clients')
            : 'No clients yet');

        const body = U.empty(r.clientsBody);

        /* The archive first: it is the thing you come here to look up. */
        const prev = U.clone('tpl-prevWork');
        U.setText(U.roles(prev).prevSub, doneCount
            ? U.plural(doneCount, 'job', 'jobs') + ' finished · ' + U.duration(Store.doneMinutes()) + ' worked'
            : 'Nothing finished yet');
        body.appendChild(prev);

        const shown = all.filter(matches);

        if (!all.length) {
            const empty = U.clone('tpl-emptyState');
            const er = U.roles(empty);
            U.setText(er.title, 'No clients yet');
            U.setText(er.sub, 'Add one here, or link a client while you are entering a job.');
            body.appendChild(empty);
        } else if (!shown.length) {
            const empty = U.clone('tpl-emptyState');
            const er = U.roles(empty);
            U.setText(er.title, 'Nothing matches “' + query + '”');
            U.setText(er.sub, 'Try part of the name or the town.');
            body.appendChild(empty);
        } else {
            body.appendChild(sectionLabel('Clients', U.plural(shown.length, 'client', 'clients')));
            shown.forEach(client => body.appendChild(clientCard(client)));
        }

        body.appendChild(U.clone('tpl-addClient'));
    }

    W.pages = W.pages || {};
    W.pages.clients = {
        init: function (el) {
            section = el;
            r = U.roles(section);

            r.clientSearch.addEventListener('input', () => {
                query = r.clientSearch.value.trim().toLowerCase();
                render();
            });

            section.addEventListener('click', e => {
                const act = e.target.closest('[data-act]');
                if (!act || !section.contains(act)) return;

                if (act.dataset.act === 'openArchive') W.sheets.archive(render);

                if (act.dataset.act === 'toggleClientSearch') {
                    const opening = r.clientSearchWrap.hidden;
                    U.toggle(r.clientSearchWrap, opening);
                    if (opening) r.clientSearch.focus();
                    else clearSearch();
                }
                if (act.dataset.act === 'clearClientSearch') clearSearch();

                if (act.dataset.act === 'newClientOnPage') {
                    // The picker already knows how to take a typed name and
                    // turn it into a client, so reuse it rather than build a
                    // second way of doing the same thing.
                    W.sheets.clients(client => {
                        render();
                        W.app.toast(client.name + ' is on the list');
                    });
                }
            });
        },

        show: render,
        render: render
    };

    function clearSearch() {
        r.clientSearch.value = '';
        query = '';
        render();
    }

}(window));
