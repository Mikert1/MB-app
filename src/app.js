/** Boot, routing between the three pages, toast, and the demo menu. */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;
    const App = W.app = {};

    const PAGES = ['week', 'avail', 'add', 'clients'];
    let current = null;
    let toastTimer = null;

    /* ---------------- routing ---------------- */

    App.go = function (name) {
        if (PAGES.indexOf(name) < 0 || name === current) return;
        current = name;

        U.$$('.page').forEach(page => page.classList.toggle('on', page.dataset.page === name));
        U.$$('.navItem[data-goto]').forEach(item => item.classList.toggle('on', item.dataset.goto === name));
        U.$('.navCenter').classList.toggle('on', name === 'add');

        // Each page scrolls independently, so a fresh page starts at the top.
        const body = U.$('.page.on .body');
        if (body) body.scrollTop = 0;

        W.pages[name].show();
        try {
            history.replaceState(null, '', '#' + name);
        } catch (e) { /* file:// refuses replaceState — the app works regardless */ }
    };

    /* ---------------- toast ---------------- */

    App.toast = function (text) {
        const el = document.getElementById('toast');
        U.setText(el, text);
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    };

    /* ---------------- the nav badge ---------------- */

    App.refreshBadge = function () {
        const badge = U.$('[data-role="availBadge"]');
        const urgent = Store.available().filter(job => {
            if (job.priority === 'urgent') return true;
            if (!job.deadline) return false;
            return U.daysBetween(U.today(), job.deadline) <= 1;
        }).length;

        U.setText(badge, urgent > 9 ? '9+' : urgent);
        U.toggle(badge, urgent > 0);
    };

    /* ---------------- demo menu (the ⋯ on My week) ---------------- */

    /**
     * The one option a tester can reach. "Reset the demo data" and "Start
     * completely empty" used to live here and were removed: a single stray
     * tap wiped everything the tester had entered, which is a real risk and
     * no help to them. Store.seed() and Store.clearAll() still exist for us.
     */
    App.demoMenu = function () {
        W.sheets.menu('Options', [
            {
                label: 'Hours in your week',
                sub: 'Now ' + U.minutesToHours(Store.settings().weekHours * 60) + ' hours \u2014 what the bar measures against',
                onPick: () => W.sheets.weekTarget(renderAll)
            }
        ]);
    };

    function renderAll() {
        PAGES.forEach(name => W.pages[name].render());
        App.refreshBadge();
    }

    /* ---------------- boot ---------------- */

    let booted = false;

    function boot() {
        // Binding every page twice would make each tap fire twice, so a second
        // call (a duplicated script tag, a stray DOMContentLoaded) is ignored.
        if (booted) return;
        booted = true;

        const splash = document.getElementById('boot');

        if (!Store.canPersist()) {
            // Private windows and locked-down browsers: the app still runs, it
            // just forgets on reload. Better to say so than to look broken.
            setTimeout(() => App.toast('This browser will not let the app save — nothing will be remembered'), 900);
        }

        Store.load();

        U.$$('.page').forEach(page => {
            const name = page.dataset.page;
            if (W.pages[name]) W.pages[name].init(page);
        });

        // Nav, and anything else that wants to jump pages (the nudge card, the
        // empty-day placeholder) carries a data-goto.
        document.addEventListener('click', e => {
            const goto = e.target.closest('[data-goto]');
            if (goto) { App.go(goto.dataset.goto); return; }

            const soon = e.target.closest('[data-soon]');
            if (soon) { App.toast(soon.dataset.soon + ' is not in this demo yet'); return; }

            const act = e.target.closest('[data-act]');
            if (act && act.dataset.act === 'closeSheet') W.sheets.close();
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && W.sheets.isOpen()) W.sheets.close();
        });

        // Another tab of the same app changed the data — pick it up.
        window.addEventListener('storage', e => {
            if (e.key === 'workium.store.v1') {
                Store.load();
                renderAll();
            }
        });

        Store.onChange(App.refreshBadge);

        const start = (location.hash || '').replace('#', '');
        current = null;
        App.go(PAGES.indexOf(start) >= 0 ? start : 'week');
        renderAll();

        document.getElementById('app').hidden = false;
        if (splash) {
            splash.classList.add('gone');
            setTimeout(() => splash.remove(), 300);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

}(window));
