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

    let section, r;

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

        if (!all.length) {
            const empty = U.clone('tpl-emptyState');
            const er = U.roles(empty);
            U.setText(er.title, 'No clients yet');
            U.setText(er.sub, 'Add one with the button below, or link a client while you are entering a job.');
            body.appendChild(empty);
        } else {
            body.appendChild(sectionLabel('Clients', U.plural(all.length, 'client', 'clients')));
            all.forEach(client => body.appendChild(clientCard(client)));
        }

        body.appendChild(U.clone('tpl-addClient'));
    }

    W.pages = W.pages || {};
    W.pages.clients = {
        init: function (el) {
            section = el;
            r = U.roles(section);

            section.addEventListener('click', e => {
                const act = e.target.closest('[data-act]');
                if (!act || !section.contains(act)) return;

                if (act.dataset.act === 'openArchive') W.sheets.archive(render);

                /* One control for both jobs: the picker searches the list and
                   can create a client that is not on it, so the page needs no
                   filter field of its own. */
                if (act.dataset.act === 'openPicker') {
                    W.sheets.clients(client => {
                        render();
                        W.sheets.client(client.id, render);
                    });
                }
            });
        },

        show: render,
        render: render
    };

}(window));
