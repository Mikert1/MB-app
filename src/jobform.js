/**
 * The job form, used twice: once on the Add page and once inside the edit
 * sheet. Mounting clones tpl-jobForm into a container and returns a small
 * controller — read(), validate(), set(), clear().
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    const PRESET_MINUTES = [30, 60, 120, 240, 480];

    W.jobForm = {
        mount: function (container, job) {
            const root = U.clone('tpl-jobForm');
            U.empty(container).appendChild(root);
            const r = U.roles(root);

            /* local state for the things that are not plain inputs */
            const state = {
                clientId: null,
                estimateMin: null,
                deadline: null,
                priority: 'normal',
                status: 'available',
                tagIds: []
            };

            /* ---------- status ---------- */

            function renderStatus() {
                const st = Store.status(state.status);
                U.setText(r.statusText, st.label);
                W.chips.paint(r.statusChip, st.tone);
                U.setText(r.statusHint, st.hint);
            }

            /* ---------- tags ---------- */

            function renderTags() {
                U.empty(r.tagRow);

                Store.tags()
                    .filter(tag => state.tagIds.indexOf(tag.id) >= 0)
                    .forEach(tag => {
                        const chip = W.chips.chip(tag.name, W.chips.tagTone(tag.color));
                        // tapping a chip takes it straight back off
                        chip.addEventListener('click', () => {
                            state.tagIds = state.tagIds.filter(id => id !== tag.id);
                            renderTags();
                        });
                        r.tagRow.appendChild(chip);
                    });

                const add = document.createElement('button');
                add.className = 'tagAdd';
                add.dataset.act = 'pickTags';
                add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
                add.appendChild(document.createTextNode(state.tagIds.length ? 'Tag' : 'Add a tag'));
                r.tagRow.appendChild(add);
            }

            /* ---------- client ---------- */

            function renderClient() {
                const client = Store.client(state.clientId);
                U.toggle(r.clientPicked, !!client);
                U.toggle(r.clientEmpty, !client);
                if (!client) return;

                U.setText(r.clientInitials, U.initials(client.name));
                U.setText(r.clientName, client.name);
                const count = Store.jobCountFor(client.id);
                U.setText(r.clientMeta, [client.location, count ? U.plural(count, 'job', 'jobs') : null]
                    .filter(Boolean).join(' · '));
            }

            function setClient(client, fillLocation) {
                state.clientId = client ? client.id : null;
                renderClient();

                // Linking a client fills the address in, but never overwrites one
                // the user already typed — a one-off address beats the file.
                if (client && fillLocation && client.location && !r.location.value.trim()) {
                    r.location.value = client.location;
                    U.toggle(r.locNote, true);
                } else if (!client) {
                    U.toggle(r.locNote, false);
                }
            }

            r.location.addEventListener('input', () => U.toggle(r.locNote, false));

            /* ---------- estimate ---------- */

            function renderEstimate() {
                const preset = state.estimateMin != null && PRESET_MINUTES.indexOf(state.estimateMin) >= 0;
                U.$$('.qchip', r.estChips).forEach(chip => {
                    const isCustom = chip.dataset.min === 'custom';
                    const on = isCustom
                        ? (state.estimateMin != null && !preset)
                        : (state.estimateMin === +chip.dataset.min);
                    chip.classList.toggle('on', on);
                });
                U.toggle(r.estCustom, state.estimateMin != null && !preset);
            }

            r.estChips.addEventListener('click', e => {
                const chip = e.target.closest('.qchip');
                if (!chip) return;

                if (chip.dataset.min === 'custom') {
                    // tapping "Other…" twice clears it again
                    const alreadyCustom = chip.classList.contains('on');
                    state.estimateMin = alreadyCustom ? null : (U.hoursToMinutes(r.estHours.value) || 0);
                    if (!alreadyCustom && !state.estimateMin) state.estimateMin = 0;
                    renderEstimate();
                    if (!alreadyCustom) r.estHours.focus();
                    return;
                }

                const mins = +chip.dataset.min;
                state.estimateMin = state.estimateMin === mins ? null : mins;
                r.estHours.value = '';
                renderEstimate();
            });

            r.estHours.addEventListener('input', () => {
                const mins = U.hoursToMinutes(r.estHours.value);
                state.estimateMin = mins == null ? 0 : mins;
            });

            /* ---------- deadline ---------- */

            function renderDeadline() {
                const iso = state.deadline;
                let active = 'none';
                if (iso) {
                    const days = U.daysBetween(U.today(), iso);
                    if (days === 0) active = 'today';
                    else if (days === 1) active = 'tomorrow';
                    else if (iso === endOfWeekIso()) active = 'week';
                    else active = 'pick';
                }
                U.$$('.qchip', r.dlChips).forEach(chip => {
                    chip.classList.toggle('on', chip.dataset.dl === active);
                });
                U.toggle(r.dlCustom, active === 'pick');
                if (iso) r.dlDate.value = iso;
            }

            /** "This week" means the coming Friday, or today if it is already past. */
            function endOfWeekIso() {
                const today = U.startOfToday();
                const friday = U.addDays(U.mondayOf(today), 4);
                return U.iso(friday < today ? today : friday);
            }

            r.dlChips.addEventListener('click', e => {
                const chip = e.target.closest('.qchip');
                if (!chip) return;
                const kind = chip.dataset.dl;

                if (kind === 'none') state.deadline = null;
                if (kind === 'today') state.deadline = U.today();
                if (kind === 'tomorrow') state.deadline = U.addDaysIso(U.today(), 1);
                if (kind === 'week') state.deadline = endOfWeekIso();
                if (kind === 'pick') {
                    state.deadline = r.dlDate.value || U.addDaysIso(U.today(), 7);
                    renderDeadline();
                    if (r.dlDate.showPicker) {
                        try { r.dlDate.showPicker(); } catch (err) { r.dlDate.focus(); }
                    } else {
                        r.dlDate.focus();
                    }
                    return;
                }
                renderDeadline();
            });

            r.dlDate.addEventListener('change', () => {
                state.deadline = r.dlDate.value || null;
                renderDeadline();
            });

            /* ---------- priority ---------- */

            function renderPriority() {
                U.$$('button', r.prioSeg).forEach(b => {
                    b.classList.toggle('on', b.dataset.p === state.priority);
                });
            }

            r.prioSeg.addEventListener('click', e => {
                const b = e.target.closest('button');
                if (!b) return;
                state.priority = b.dataset.p;
                renderPriority();
            });

            /* ---------- title ---------- */

            r.title.addEventListener('input', () => {
                r.title.classList.remove('bad');
                U.toggle(r.titleErr, false);
            });

            /* ---------- the picker lives in a sheet ---------- */

            root.addEventListener('click', e => {
                const act = e.target.closest('[data-act]');
                if (!act) return;

                if (act.dataset.act === 'clearClient') {
                    e.stopPropagation();
                    setClient(null, false);
                    return;
                }
                if (act.dataset.act === 'pickClient') {
                    W.sheets.clients(client => setClient(client, true));
                }

                if (act.dataset.act === 'pickStatus') {
                    W.sheets.status(state.status, id => {
                        state.status = id;
                        renderStatus();
                    });
                }

                if (act.dataset.act === 'pickTags') {
                    W.sheets.tags(state.tagIds, ids => {
                        state.tagIds = ids;
                        renderTags();
                    });
                }
            });

            /* ---------- controller ---------- */

            const api = {
                root: root,

                set: function (fields) {
                    const f = fields || {};
                    r.title.value = f.title || '';
                    r.location.value = f.location || '';
                    r.notes.value = f.notes || '';
                    state.clientId = f.clientId || null;
                    state.estimateMin = f.estimateMin == null ? null : f.estimateMin;
                    state.deadline = f.deadline || null;
                    state.priority = f.priority || 'normal';
                    state.status = f.status || 'available';
                    state.tagIds = Array.isArray(f.tagIds) ? f.tagIds.slice() : [];

                    if (state.estimateMin != null && PRESET_MINUTES.indexOf(state.estimateMin) < 0) {
                        r.estHours.value = U.minutesToHours(state.estimateMin);
                    } else {
                        r.estHours.value = '';
                    }

                    r.title.classList.remove('bad');
                    U.toggle(r.titleErr, false);
                    renderClient();
                    renderEstimate();
                    renderDeadline();
                    renderPriority();
                    renderStatus();
                    renderTags();
                },

                read: function () {
                    return {
                        title: r.title.value.trim(),
                        clientId: state.clientId,
                        location: r.location.value.trim(),
                        // a custom estimate left at 0 counts as "no estimate given"
                        estimateMin: state.estimateMin ? state.estimateMin : null,
                        deadline: state.deadline,
                        priority: state.priority,
                        status: state.status,
                        tagIds: state.tagIds.slice(),
                        notes: r.notes.value.trim()
                    };
                },

                validate: function () {
                    const ok = r.title.value.trim().length > 0;
                    r.title.classList.toggle('bad', !ok);
                    U.toggle(r.titleErr, !ok);
                    if (!ok) {
                        r.title.focus();
                        // not every engine has it, and a missing scroll must
                        // never swallow the validation message
                        if (r.title.scrollIntoView) {
                            r.title.scrollIntoView({ block: 'center', behavior: 'smooth' });
                        }
                    }
                    return ok;
                },

                clear: function () {
                    api.set(null);
                },

                focusTitle: function () {
                    r.title.focus();
                }
            };

            api.set(job);
            return api;
        }
    };

}(window));
