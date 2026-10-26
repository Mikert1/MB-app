/**
 * The coloured chips every card wears, in one place.
 *
 * A card's colour comes from its status; priority is now only ever a chip of
 * its own, and custom tags bring their own colour. All of it resolves to a
 * CSS variable name, never a hex literal, so a light theme can be added by
 * swapping the palette in style.css.
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;
    const Chips = W.chips = {};

    /** `--status-agreed` -> the colour, read from the live stylesheet. */
    Chips.tone = function (varName) {
        return varName ? 'var(' + varName + ')' : '';
    };

    Chips.tagTone = function (colorName) {
        return '--tag-' + (colorName || 'grey');
    };

    /** Paint an element with a palette colour, for the rail / dot / chip. */
    Chips.paint = function (el, varName) {
        if (el) el.style.setProperty('--tone', Chips.tone(varName));
    };

    /**
     * Paint an element as a status: its colour, plus data-status, which
     * style.css turns into the glyph that fills up as a job firms up.
     */
    Chips.paintStatus = function (el, status) {
        if (!el) return;
        Chips.paint(el, status.tone);
        el.dataset.status = status.id;
    };

    /** A coloured chip. `solid` fills it instead of tinting it. */
    Chips.chip = function (text, varName, solid) {
        const chip = U.clone('tpl-tagChip');
        U.setText(U.roles(chip).text, text);
        Chips.paint(chip, varName);
        if (solid) chip.classList.add('solid');
        return chip;
    };

    /** Where a job stands, tinted in that status's colour with its glyph. */
    Chips.status = function (status) {
        const chip = Chips.chip(status.label);
        Chips.paintStatus(chip, status);
        return chip;
    };

    const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', low: 'Low' };

    /** Urgent is the only filled one; high and low are an arrow on grey. */
    Chips.priority = function (priority) {
        const chip = Chips.chip(PRIORITY_LABEL[priority] || priority);
        chip.dataset.prio = priority;
        return chip;
    };

    /** A custom tag: grey, with a dot of its own colour. */
    Chips.tag = function (tag) {
        const chip = Chips.chip(tag.name, Chips.tagTone(tag.color));
        chip.classList.add('isTag');
        return chip;
    };

    /** A plain uncoloured chip, for facts like a duration or a deadline. */
    Chips.plain = function (text, tone) {
        const chip = U.clone('tpl-chip');
        if (tone) chip.classList.add(tone);
        U.setText(U.roles(chip).text, text);
        return chip;
    };

    /**
     * Every chip a job should wear, in reading order: where it stands, how
     * urgent it is, then its own tags. Deliberately does NOT include the
     * duration or the deadline — those differ per page.
     */
    Chips.forJob = function (job, options) {
        const opts = options || {};
        const out = [];

        // First in the row: the title gets the card's full width, and the
        // status leads the chips beneath it.
        if (opts.status !== false) out.push(Chips.status(Store.status(job.status)));

        if (Store.priorityTone(job.priority)) out.push(Chips.priority(job.priority));

        Store.tagsOf(job).forEach(tag => out.push(Chips.tag(tag)));

        return out;
    };

    /** Fill a chip container for a job, plus whatever extras the page adds. */
    Chips.fill = function (host, job, options) {
        const opts = options || {};
        U.empty(host);
        Chips.forJob(job, opts).forEach(chip => host.appendChild(chip));
        (opts.extra || []).forEach(chip => host.appendChild(chip));
    };

}(window));
