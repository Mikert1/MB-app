/** Page 3 — add work, built for someone who is on the phone right now. */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    let section, r, form, pendingClient = null;

    function save(thenPlan) {
        if (!form.validate()) return;

        const fields = form.read();
        const job = Store.addJob(fields);
        form.clear();

        W.app.refreshBadge();
        W.pages.avail.render();
        W.pages.week.render();

        if (thenPlan) {
            W.sheets.plan(job.id, () => {
                W.app.refreshBadge();
                W.pages.avail.render();
                W.pages.week.render();
                W.app.go('week');
            });
            return;
        }

        W.app.toast('Saved to available work');
        W.app.go('avail');
    }

    W.pages = W.pages || {};
    W.pages.add = {
        init: function (el) {
            section = el;
            r = U.roles(section);
            form = W.jobForm.mount(r.addForm, null);

            section.addEventListener('click', e => {
                const act = e.target.closest('[data-act]');
                if (!act || !section.contains(act)) return;

                if (act.dataset.act === 'save') save(false);
                if (act.dataset.act === 'saveAndPlan') save(true);
                if (act.dataset.act === 'resetForm') {
                    form.clear();
                    W.app.toast('Form emptied');
                }
            });
        },

        /**
         * Opened from a client's sheet ("New job for this client"): the form
         * starts with that client already linked, address and all.
         */
        startWithClient: function (clientId) {
            pendingClient = clientId;
        },

        /** Land with the cursor in the title — the only field that matters. */
        show: function () {
            if (pendingClient) {
                // Their address comes along too, exactly as it would if you
                // had linked the client from inside the form.
                const client = Store.client(pendingClient);
                form.set({
                    clientId: pendingClient,
                    location: client && client.location ? client.location : ''
                });
                pendingClient = null;
                return; // the client is filled in; the title is theirs to type
            }
            // Desktop only: on a phone this would throw the keyboard up over
            // the form before the user has decided to type anything.
            if (window.matchMedia('(min-width: 540px)').matches) form.focusTitle();
        },

        render: function () {}
    };

}(window));
