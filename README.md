kGantt
======

## Why Another Gantt Library

I've looked into several libraries, both proprietary and free software, and they either are too expensive for the 
I need to use a Gantt chart or have licenses that make it difficult to use in proprietary projects, or don't offer the 
features I need.

One of the best Gantt components I've found is Oracle JET Gantt, unfortunately it requires me to build a full OJET 
based SPA application and integration those into non SPA, or simple HTML/CSS + JS projects (no UI or APP frameworks) 
takes more time (and effort) than it should.

The second-best Gantt component is jQueryGantt, that I've forked to build this project, with the following 
requirements/goals:

- Simple to use and integrate into HTML, CSS and JavaScript projects that don't use frameworks (currently, kGantt 
still depends on jQuery);
- Free software that offers a good set of base features;
- Prefer vanilla JavaScript, with as little dependencies as possible;

## Original Project

Based on jQueryGantt, a jQuery based Gantt editor written by Roberto Bicchierai and Silvia Chelazzi, part of the
[Twproject](https://twproject.com), with code available at https://github.com/robicch/jQueryGantt.

<img src="twproject_original_gantt_screenshot.jpg" alt="Twproject jQuery Gantt Original Screenshot">

These are some key features from jQueryGantt that are still true in kGantt:

* jQuery based 3.2
* MIT licensed: you can reuse everywhere https://opensource.org/licenses/MIT
* JSON import-export
* internationalizable
* manage task status –> project workflow
* manage dependencies
* manage assignments (resources, roles efforts)
* server synchronization ready
* full undo-redo support
* cross browser (at least for recent versions)
* keyboard editing support
* SVG visual editor
* print friendly
* collapsible branches
* critical path
* milestones, progress etc.
* zoom

## Resources

### Favicon

Currently used favicon (just a placeholder) was generated using the following:

- Font Title: Lato
- Font Author: Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic (team@latofonts.com) with Reserved Font Name "Lato". Licensed under the SIL Open Font License, Version 1.1.
- Font Source: https://fonts.gstatic.com/s/lato/v24/S6uyw4BMUTPHvxk6XweuBCY.ttf
- Font License: SIL Open Font License, 1.1 (http://scripts.sil.org/OFL))

Generator: https://favicon.io/favicon-generator/

### Icons

Icons from https://tabler.io/icons