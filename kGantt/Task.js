/*
 Copyright (c) 2012-2018 Open Lab
 Written by Roberto Bicchierai and Silvia Chelazzi http://roberto.open-lab.com
 Permission is hereby granted, free of charge, to any person obtaining
 a copy of this software and associated documentation files (the
 "Software"), to deal in the Software without restriction, including
 without limitation the rights to use, copy, modify, merge, publish,
 distribute, sublicense, and/or sell copies of the Software, and to
 permit persons to whom the Software is furnished to do so, subject to
 the following conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * A method to instantiate valid task models from
 * raw data.
 */
function TaskFactory() {

    /**
     * Build a new Task
     */
    this.build = function (id, name, code, level, start, duration, collapsed) {
        // Set at beginning of day
        const adjusted_start = computeStart(start);
        const calculated_end = computeEndByDuration(adjusted_start, duration);
        return new Task(id, name, code, level, adjusted_start, calculated_end, duration, collapsed);
    };
}

function Task(id, name, code, level, start, end, duration, collapsed) {
    this.id = id;
    this.name = name;
    this.progress = 0;
    this.progressByWorklog = false;
    this.relevance = 0;
    this.type = "";
    this.typeId = "";
    this.description = "";
    this.code = code;
    this.level = level;
    this.status = "STATUS_UNDEFINED";
    this.depends = "";
    this.start = start;
    this.duration = duration;
    this.end = end;
    this.startIsMilestone = false;
    this.endIsMilestone = false;
    this.collapsed = collapsed;

    //permissions
    // by default all true, but must be inherited from parent
    this.canWrite = true;
    this.canAdd = true;
    this.canDelete = true;
    this.canAddIssue = true;

    this.rowElement; //row editor html element
    this.ganttElement; //gantt html element
    this.master;

    this.assigs = [];
}

Task.prototype.clone = function () {
    const ret = {};
    for (const key in this) {
        if (typeof (this[key]) != "function") {
            if (typeof (this[key]) != "object" || Array.isArray(this[key])) {
                ret[key] = this[key];
            }
        }
    }
    return ret;
};

Task.prototype.getAssigsString = function () {
    let ret = "";
    for (let i = 0; i < this.assigs.length; i++) {
        const ass = this.assigs[i];
        const res = this.master.getResource(ass.resourceId);
        if (res) {
            ret = ret + (ret == "" ? "" : ", ") + res.name;
        }
    }
    return ret;
};

Task.prototype.createAssignment = function (id, resourceId, roleId, effort) {
    const assign = new Assignment(id, resourceId, roleId, effort);
    this.assigs.push(assign);
    return assign;
};

//<%---------- SET PERIOD ---------------------- --%>
Task.prototype.setPeriod = function (start, end) {
    if (start instanceof Date) {
        start = start.getTime();
    }

    if (end instanceof Date) {
        end = end.getTime();
    }

    const originalPeriod = {
        start: this.start,
        end: this.end,
        duration: this.duration
    };

    //compute legal start/end //todo mossa qui R&S 30/3/2016 perchè altrimenti il calcolo della durata, che è stato modificato sommando giorni, sbaglia
    start = computeStart(start);
    end = computeEnd(end);

    const newDuration = recomputeDuration(start, end);
    //if are equals do nothing and return true
    if (start == originalPeriod.start && end == originalPeriod.end && newDuration == originalPeriod.duration) {
        return true;
    }

    if (newDuration == this.duration) { // is shift
        return this.moveTo(start, false, true);
    }

    const wantedStartMillis = start;
    const children = this.getChildren();
    if (this.master.shrinkParent && children.length > 0) {
        const chPeriod = this.getChildrenBoudaries();
        start = chPeriod.start;
        end = chPeriod.end;
    }

    //cannot start after end
    if (start > end) {
        start = end;
    }

    //if there are dependencies compute the start date and eventually moveTo
    var startBySuperiors = this.computeStartBySuperiors(start);
    if (startBySuperiors != start) {
        return this.moveTo(startBySuperiors, false, true);
    }

    let somethingChanged = false;
    if (this.start != start || this.start != wantedStartMillis) {
        this.start = start;
        somethingChanged = true;
    }

    //set end
    const wantedEndMillis = end;
    if (this.end != end || this.end != wantedEndMillis) {
        this.end = end;
        somethingChanged = true;
    }
    this.duration = recomputeDuration(this.start, this.end);

    //nothing changed exit
    if (!somethingChanged) {
        return true;
    }

    //cannot write exit
    if (!this.canWrite) {
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + Gantt.messages["CANNOT_WRITE"], this);
        return false;
    }

    //external dependencies: exit with error
    if (this.hasExternalDep) {
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + Gantt.messages["TASK_HAS_EXTERNAL_DEPS"], this);
        return false;
    }

    let todoOk = true;

    //I'm restricting
    const deltaPeriod = originalPeriod.duration - this.duration;
    const restricting = deltaPeriod > 0;
    const enlarging = deltaPeriod < 0;
    const restrictingStart = restricting && (originalPeriod.start < this.start);
    const restrictingEnd = restricting && (originalPeriod.end > this.end);

    if (restricting) {
        //loops children to get boundaries
        let bs = Infinity;
        let be = 0;
        for (let i = 0; i < children.length; i++) {
            const ch = children[i];
            if (restrictingEnd) {
                be = Math.max(be, ch.end);
            } else {
                bs = Math.min(bs, ch.start);
            }
        }

        if (restrictingEnd) {
            this.end = Math.max(be, this.end);
        } else {
            this.start = Math.min(bs, this.start);
        }

        this.duration = recomputeDuration(this.start, this.end);
        if (this.master.shrinkParent) {
            todoOk = updateTree(this);
        }
    } else {
        //check global boundaries
        if (this.start < this.master.minEditableDate || this.end > this.master.maxEditableDate) {
            this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + Gantt.messages["CHANGE_OUT_OF_SCOPE"], this);
            todoOk = false;
        }

        //console.debug("set period: somethingChanged",this);
        if (todoOk) {
            todoOk = updateTree(this);
        }
    }

    if (todoOk) {
        todoOk = this.propagateToInferiors(end);
    }
    return todoOk;
};


//<%---------- MOVE TO ---------------------- --%>
Task.prototype.moveTo = function (start, ignoreMilestones, propagateToInferiors) {
    let ch;
    if (start instanceof Date) {
        start = start.getTime();
    }

    const originalPeriod = {
        start: this.start,
        end: this.end
    };
    const wantedStartMillis = start;

    //set a legal start
    start = computeStart(start);

    //if depends, start is set to max end + lag of superior
    start = this.computeStartBySuperiors(start);

    const end = computeEndByDuration(start, this.duration);
    //check milestones compatibility
    if (!this.checkMilestonesConstraints(start, end, ignoreMilestones)) {
        return false;
    }

    if (this.start != start || this.start != wantedStartMillis) {
        let i;
        this.start = start;
        this.end = end;
        //check global boundaries
        if (this.start < this.master.minEditableDate || this.end > this.master.maxEditableDate) {
            this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + Gantt.messages["CHANGE_OUT_OF_SCOPE"], this);
            return false;
        }

        // bicch 22/4/2016: quando si sposta un task con child a cavallo di holidays, i figli devono essere shiftati in workingDays, non in millisecondi, altrimenti si cambiano le durate
        // when moving children you MUST consider WORKING days,
        const panDeltaInWM = getDistanceInUnits(new Date(originalPeriod.start), new Date(this.start));
        //loops children to shift them
        const children = this.getChildren();
        for (i = 0; i < children.length; i++) {
            ch = children[i];
            const chStart = incrementDateByUnits(new Date(ch.start), panDeltaInWM);
            ch.moveTo(chStart, false, false);
        }

        if (!updateTree(this)) {
            return false;
        }

        if (propagateToInferiors) {
            this.propagateToInferiors(end);
            const todoOk = true;
            const descendants = this.getDescendant();
            for (i = 0; i < descendants.length; i++) {
                ch = descendants[i];
                if (!ch.propagateToInferiors(ch.end))
                    return false;
            }
        }
    }

    return true;
};


Task.prototype.checkMilestonesConstraints = function (newStart, newEnd, ignoreMilestones) {
    //if start is milestone cannot be move
    if (!ignoreMilestones && (this.startIsMilestone && newStart != this.start)) {
        //notify error
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + Gantt.messages["START_IS_MILESTONE"], this);
        return false;
    } else if (!ignoreMilestones && (this.endIsMilestone && newEnd != this.end)) {
        //notify error
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + Gantt.messages["END_IS_MILESTONE"], this);
        return false;
    } else if (this.hasExternalDep) {
        //notify error
        this.master.setErrorOnTransaction("\"" + this.name + "\"\n" + Gantt.messages["TASK_HAS_EXTERNAL_DEPS"], this);
        return false;
    }
    return true;
};

//<%---------- PROPAGATE TO INFERIORS ---------------------- --%>
Task.prototype.propagateToInferiors = function (end) {
    //and now propagate to inferiors
    let todoOk = true;
    const infs = this.getInferiors();
    if (infs && infs.length > 0) {
        for (let i = 0; i < infs.length; i++) {
            const link = infs[i];
            if (!link.to.canWrite) {
                this.master.setErrorOnTransaction(Gantt.messages["CANNOT_WRITE"] + "\n\"" + link.to.name + "\"", link.to);
                break;
            }
            todoOk = link.to.moveTo(end, false, true); //this is not the right date but moveTo checks start
            if (!todoOk) {
                break;
            }
        }
    }
    return todoOk;
};

//<%---------- COMPUTE START BY SUPERIORS ---------------------- --%>
Task.prototype.computeStartBySuperiors = function (proposedStart) {
    //if depends -> start is set to max end + lag of superior
    let supEnd = proposedStart;
    const sups = this.getSuperiors();
    if (sups && sups.length > 0) {
        supEnd = 0;
        for (let i = 0; i < sups.length; i++) {
            const link = sups[i];
            supEnd = Math.max(supEnd, incrementDateByUnits(new Date(link.from.end), link.lag));
        }
        supEnd += 1;
    }
    return computeStart(supEnd);
};

function updateTree(task) {
    //console.debug("updateTree ",task.code,task.name, new Date(task.start), new Date(task.end));
    let error;

    //try to enlarge parent
    const p = task.getParent();

    //no parent:exit
    if (!p) {
        return true;
    }

    let newStart;
    let newEnd;

    //id shrink start and end are computed on children boundaries
    if (task.master.shrinkParent) {
        const chPeriod = p.getChildrenBoudaries();
        newStart = chPeriod.start;
        newEnd = chPeriod.end;
    } else {
        newStart = p.start;
        newEnd = p.end;

        if (p.start > task.start) {
            newStart = task.start;
        }
        if (p.end < task.end) {
            newEnd = task.end;
        }
    }

    if (p.start != newStart) {
        if (p.startIsMilestone) {
            task.master.setErrorOnTransaction("\"" + p.name + "\"\n" + Gantt.messages["START_IS_MILESTONE"], task);
            return false;
        } else if (p.depends) {
            task.master.setErrorOnTransaction("\"" + p.name + "\"\n" + Gantt.messages["TASK_HAS_CONSTRAINTS"], task);
            return false;
        }
    }
    if (p.end != newEnd) {
        if (p.endIsMilestone) {
            task.master.setErrorOnTransaction("\"" + p.name + "\"\n" + Gantt.messages["END_IS_MILESTONE"], task);
            return false;
        }
    }

    //propagate updates if needed
    if (newStart != p.start || newEnd != p.end) {
        //can write?
        if (!p.canWrite) {
            task.master.setErrorOnTransaction(Gantt.messages["CANNOT_WRITE"] + "\n" + p.name, task);
            return false;
        }

        //has external deps ?
        if (p.hasExternalDep) {
            task.master.setErrorOnTransaction(Gantt.messages["TASK_HAS_EXTERNAL_DEPS"] + "\n\"" + p.name + "\"", task);
            return false;
        }
        return p.setPeriod(newStart, newEnd);
    }
    return true;
}

Task.prototype.getChildrenBoudaries = function () {
    let newStart = Infinity;
    let newEnd = -Infinity;
    const children = this.getChildren();
    for (let i = 0; i < children.length; i++) {
        const ch = children[i];
        newStart = Math.min(newStart, ch.start);
        newEnd = Math.max(newEnd, ch.end);
    }
    return ({start: newStart, end: newEnd})
}

//<%---------- CHANGE STATUS ---------------------- --%>
Task.prototype.changeStatus = function (newStatus, forceStatusCheck) {
    //console.debug("changeStatus: "+this.name+" from "+this.status+" -> "+newStatus);

    const cone = this.getDescendant();

    function propagateStatus(task, newStatus, manuallyChanged, propagateFromParent, propagateFromChildren) {
        let par;
        let i;
        let sups;
        const oldStatus = task.status;
        //no changes exit
        if (newStatus == oldStatus && !forceStatusCheck) {
            return true;
        }

        let todoOk = true;
        task.status = newStatus;

        //xxxx -> STATUS_DONE            may activate dependent tasks, both suspended and undefined. Will set to done all children.
        //STATUS_FAILED -> STATUS_DONE   do nothing if not forced by hand
        if (newStatus == "STATUS_DONE") {
            // cannot close task if open issues
            if (task.master.permissions.cannotCloseTaskIfIssueOpen && task.openIssues > 0) {
                task.master.setErrorOnTransaction(Gantt.messages["CANNOT_CLOSE_TASK_IF_OPEN_ISSUE"] + " \"" + task.name + "\"");
                return false;
            }

            if ((manuallyChanged || oldStatus != "STATUS_FAILED")) { //cannot set failed task as closed for cascade - only if changed manually
                //can be closed only if superiors are already done
                sups = task.getSuperiors();
                for (i = 0; i < sups.length; i++) {
                    if (sups[i].from.status != "STATUS_DONE" && cone.indexOf(sups[i].from) < 0) { // è un errore se un predecessore è non chiuso ed è fuori dal cono
                        if (manuallyChanged || propagateFromParent) {  //genere un errore bloccante se è cambiato a mano o se il cambiamento arriva dal parent ed ho una dipendenza fuori dal cono (altrimenti avrei un attivo figlio di un chiuso
                            task.master.setErrorOnTransaction(Gantt.messages["GANTT_ERROR_DEPENDS_ON_OPEN_TASK"] + "\n\"" + sups[i].from.name + "\" -> \"" + task.name + "\"");
                        }
                        todoOk = false;
                        break;
                    }
                }

                if (todoOk) {
                    // set progress to 100% if needed by settings
                    if (task.master.set100OnClose && !task.progressByWorklog) {
                        task.progress = 100;
                    }

                    //set children as done
                    propagateStatusToChildren(task, newStatus, false);

                    //set inferiors as active
                    propagateStatusToInferiors(task.getInferiors(), "STATUS_ACTIVE");
                }
            } else { // una propagazione tenta di chiudere un task fallito
                todoOk = false;
            }

            //  STATUS_UNDEFINED -> STATUS_ACTIVE       all children become active, if they have no dependencies.
            //  STATUS_SUSPENDED -> STATUS_ACTIVE       sets to active all children and their descendants that have no inhibiting dependencies.
            //  STATUS_WAITING -> STATUS_ACTIVE         sets to active all children and their descendants that have no inhibiting dependencies.
            //  STATUS_DONE -> STATUS_ACTIVE            all those that have dependencies must be set to suspended.
            //  STATUS_FAILED -> STATUS_ACTIVE          nothing happens: child statuses must be reset by hand.
        } else if (newStatus == "STATUS_ACTIVE") {
            if (manuallyChanged || (oldStatus != "STATUS_FAILED" && oldStatus != "STATUS_SUSPENDED")) { //cannot set failed or suspended task as active for cascade - only if changed manually

                //can be active only if superiors are already done, not only on this task, but also on ancestors superiors
                sups = task.getSuperiors();
                for (i = 0; i < sups.length; i++) {
                    if (sups[i].from.status != "STATUS_DONE") {
                        if (manuallyChanged || propagateFromChildren)
                            task.master.setErrorOnTransaction(Gantt.messages["GANTT_ERROR_DEPENDS_ON_OPEN_TASK"] + "\n\"" + sups[i].from.name + "\" -> \"" + task.name + "\"");
                        todoOk = false;
                        break;
                    }
                }

                // check if parent is already active
                if (todoOk) {
                    par = task.getParent();
                    if (par && par.status != "STATUS_ACTIVE") {
                        // todoOk = propagateStatus(par, "STATUS_ACTIVE", false, false, true); //todo abbiamo deciso di non far propagare lo status verso l'alto
                        todoOk = false;
                    }
                }

                if (todoOk) {
                    if (oldStatus == "STATUS_UNDEFINED" || oldStatus == "STATUS_SUSPENDED" || oldStatus == "STATUS_WAITING") {
                        //set children as active
                        propagateStatusToChildren(task, newStatus, true);
                    }

                    propagateStatusToInferiors(task.getInferiors(), "STATUS_WAITING");
                }
            } else {
                todoOk = false;
            }

            // xxxx -> STATUS_WAITING       all active children and their active descendants become waiting. when not failed or forced
        } else if (newStatus == "STATUS_WAITING") {
            if (manuallyChanged || oldStatus != "STATUS_FAILED") { //cannot set failed task as waiting for cascade - only if changed manually

                //check if parent if not active
                par = task.getParent();
                if (par && (par.status != "STATUS_ACTIVE" && par.status != "STATUS_SUSPENDED" && par.status != "STATUS_WAITING")) {
                    todoOk = false;
                }
                if (todoOk) {
                    //set children as STATUS_WAITING
                    propagateStatusToChildren(task, "STATUS_WAITING", true);

                    //set inferiors as STATUS_WAITING
                    propagateStatusToInferiors(task.getInferiors(), "STATUS_WAITING");
                }
            } else {
                todoOk = false;
            }

            // xxxx -> STATUS_SUSPENDED       all active children and their active descendants become suspended. when not failed or forced
        } else if (newStatus == "STATUS_SUSPENDED") {
            if (manuallyChanged || oldStatus != "STATUS_FAILED") { //cannot set failed task as closed for cascade - only if changed manually

                //check if parent if not active
                par = task.getParent();
                if (par && (par.status != "STATUS_ACTIVE" && par.status != "STATUS_SUSPENDED" && par.status != "STATUS_WAITING")) {
                    todoOk = false;
                }

                if (todoOk) {
                    //set children as STATUS_SUSPENDED
                    propagateStatusToChildren(task, "STATUS_SUSPENDED", true);

                    //set inferiors as STATUS_SUSPENDED
                    propagateStatusToInferiors(task.getInferiors(), "STATUS_SUSPENDED");
                }
            } else {
                todoOk = false;
            }

            // xxxx -> STATUS_FAILED children and dependent failed
            // xxxx -> STATUS_UNDEFINED  children and dependant become undefined.
        } else if (newStatus == "STATUS_FAILED" || newStatus == "STATUS_UNDEFINED") {

            //set children as failed or undefined
            propagateStatusToChildren(task, newStatus, false);

            //set inferiors as failed
            propagateStatusToInferiors(task.getInferiors(), newStatus);
        }
        if (!todoOk) {
            task.status = oldStatus;
            //console.debug("status rolled back: "+task.name + " to " + oldStatus);
        }

        return todoOk;
    }

    /**
     * A helper method to traverse an array of 'inferior' tasks
     * and signal a status change.
     */
    function propagateStatusToInferiors(infs, status) {
        for (var i = 0; i < infs.length; i++) {
            propagateStatus(infs[i].to, status, false, false, false);
        }
    }

    /**
     * A helper method to loop children and propagate new status
     */
    function propagateStatusToChildren(task, newStatus, skipClosedTasks) {
        var chds = task.getChildren();
        for (var i = 0; i < chds.length; i++)
            if (!(skipClosedTasks && chds[i].status == "STATUS_DONE"))
                propagateStatus(chds[i], newStatus, false, true, false);
    }


    const manuallyChanged = true;
    const oldStatus = this.status;
    //first call
    if (propagateStatus(this, newStatus, manuallyChanged, false, false)) {
        return true;
    } else {
        this.status = oldStatus;
        return false;
    }
};

Task.prototype.synchronizeStatus = function () {
    const oldS = this.status;
    this.status = this.getParent() ? this.getParent().status : "STATUS_UNDEFINED"; // di default si invalida lo stato mettendo quello del padre, in modo che inde/outd siano consistenti
    return this.changeStatus(oldS, true);
};

Task.prototype.isLocallyBlockedByDependencies = function () {
    const sups = this.getSuperiors();
    let blocked = false;
    for (let i = 0; i < sups.length; i++) {
        if (sups[i].from.status != "STATUS_DONE") {
            blocked = true;
            break;
        }
    }
    return blocked;
};

//<%---------- TASK STRUCTURE ---------------------- --%>
Task.prototype.getRow = function () {
    let ret = -1;
    if (this.master) {
        ret = this.master.tasks.indexOf(this);
    }

    return ret;
};

Task.prototype.getParents = function () {
    let ret;
    if (this.master) {
        let topLevel = this.level;
        const pos = this.getRow();
        ret = [];
        for (let i = pos; i >= 0; i--) {
            const par = this.master.tasks[i];
            if (topLevel > par.level) {
                topLevel = par.level;
                ret.push(par);
            }
        }
    }
    return ret;
};

Task.prototype.getParent = function () {
    let ret;
    if (this.master) {
        for (let i = this.getRow(); i >= 0; i--) {
            const par = this.master.tasks[i];
            if (this.level > par.level) {
                ret = par;
                break;
            }
        }
    }
    return ret;
};

Task.prototype.isParent = function () {
    let ret = false;
    if (this.master) {
        const pos = this.getRow();
        if (pos < this.master.tasks.length - 1) {
            ret = this.master.tasks[pos + 1].level > this.level;
        }
    }
    return ret;
};

Task.prototype.getChildren = function () {
    const ret = [];
    if (this.master) {
        const pos = this.getRow();
        for (let i = pos + 1; i < this.master.tasks.length; i++) {
            const ch = this.master.tasks[i];
            if (ch.level == this.level + 1) {
                ret.push(ch);
            } else if (ch.level <= this.level) {// exit loop if parent or brother
                break;
            }
        }
    }
    return ret;
};

Task.prototype.getDescendant = function () {
    const ret = [];
    if (this.master) {
        const pos = this.getRow();
        for (let i = pos + 1; i < this.master.tasks.length; i++) {
            const ch = this.master.tasks[i];
            if (ch.level > this.level) {
                ret.push(ch);
            } else {
                break;
            }
        }
    }
    return ret;
};

Task.prototype.getSuperiors = function () {
    let ret = [];
    const task = this;
    if (this.master) {
        ret = this.master.links.filter(function (link) {
            return link.to == task;
        });
    }
    return ret;
};

Task.prototype.getSuperiorTasks = function () {
    const ret = [];
    const sups = this.getSuperiors();
    for (let i = 0; i < sups.length; i++) {
        ret.push(sups[i].from);
    }
    return ret;
};

Task.prototype.getInferiors = function () {
    let ret = [];
    const task = this;
    if (this.master) {
        ret = this.master.links.filter(function (link) {
            return link.from == task;
        });
    }
    return ret;
};

Task.prototype.getInferiorTasks = function () {
    const ret = [];
    const infs = this.getInferiors();
    for (let i = 0; i < infs.length; i++) {
        ret.push(infs[i].to);
    }
    return ret;
};

Task.prototype.deleteTask = function () {
    //if is the current one remove it
    if (this.master.currentTask && this.master.currentTask.id == this.id) {
        delete this.master.currentTask;
    }

    //delete both dom elements if exists
    if (this.rowElement) {
        this.rowElement.remove();
    }
    if (this.ganttElement) {
        this.ganttElement.remove();
    }

    //remove children
    const chd = this.getChildren();
    for (let i = 0; i < chd.length; i++) {
        //add removed child in list
        chd[i].deleteTask();
    }

    if (!this.isNew()) {
        this.master.deletedTaskIds.push(this.id);
    }

    //remove from in-memory collection
    this.master.tasks.splice(this.getRow(), 1);

    //remove from links
    const task = this;
    this.master.links = this.master.links.filter(function (link) {
        return link.from != task && link.to != task;
    });
};

Task.prototype.isNew = function () {
    return (this.id + "").indexOf("tmp_") == 0;
};

Task.prototype.isDependent = function (t) {
    let i;
    const task = this;
    const dep = this.master.links.filter(function (link) {
        return link.from == task;
    });

    // is t a direct dependency?
    for (i = 0; i < dep.length; i++) {
        if (dep[i].to == t) {
            return true;
        }
    }

    // is t an indirect dependency
    for (i = 0; i < dep.length; i++) {
        if (dep[i].to.isDependent(t)) {
            return true;
        }
    }
    return false;
};

Task.prototype.setLatest = function (maxCost) {
    this.latestStart = maxCost - this.criticalCost;
    this.latestFinish = this.latestStart + this.duration;
};

//<%------------------------------------------  INDENT/OUTDENT --------------------------------%>
Task.prototype.indent = function () {
    //a row above must exist
    const row = this.getRow();

    //no row no party
    if (row <= 0) {
        return false;
    }

    let ret = false;
    const taskAbove = this.master.tasks[row - 1];
    const newLev = this.level + 1;
    if (newLev <= taskAbove.level + 1) {
        ret = true;

        //trick to get parents after indent
        this.level++;
        const futureParents = this.getParents();
        this.level--;

        const oldLevel = this.level;
        for (let i = row; i < this.master.tasks.length; i++) {
            const desc = this.master.tasks[i];
            if (desc.level > oldLevel || desc == this) {
                desc.level++;
                //remove links from this and descendant to my parents
                this.master.links = this.master.links.filter(function (link) {
                    let linkToParent = false;
                    if (link.to == desc) {
                        linkToParent = futureParents.indexOf(link.from) >= 0;
                    } else if (link.from == desc) {
                        linkToParent = futureParents.indexOf(link.to) >= 0;
                    }
                    return !linkToParent;
                });

                //remove links from this and descendants to predecessors of parents in order to avoid loop
                let predecessorsOfFutureParents = [];
                for (let j = 0; j < futureParents.length; j++) {
                    predecessorsOfFutureParents = predecessorsOfFutureParents.concat(futureParents[j].getSuperiorTasks());
                }

                this.master.links = this.master.links.filter(function (link) {
                    let linkToParent = false;
                    if (link.from == desc) {
                        linkToParent = predecessorsOfFutureParents.indexOf(link.to) >= 0;
                    }
                    return !linkToParent;
                });
            } else {
                break;
            }
        }

        const parent = this.getParent();
        // set start date to parent' start if no deps
        if (parent && !this.depends) {
            const new_end = computeEndByDuration(parent.start, this.duration);
            this.master.changeTaskDates(this, parent.start, new_end);
        }

        //recompute depends string
        this.master.updateDependsStrings();
        //enlarge parent using a fake set period
        updateTree(this);
        //force status check starting from parent
        this.getParent().synchronizeStatus();
    }

    return ret;
};

Task.prototype.outdent = function () {
    let i;
//a level must be >1 -> cannot escape from root
    if (this.level <= 1) {
        return false;
    }

    let ret = false;
    const oldLevel = this.level;

    ret = true;
    const row = this.getRow();
    for (i = row; i < this.master.tasks.length; i++) {
        const desc = this.master.tasks[i];
        if (desc.level > oldLevel || desc == this) {
            desc.level--;
        } else {
            break;
        }
    }

    const task = this;
    const chds = this.getChildren();
    //remove links from me to my new children
    this.master.links = this.master.links.filter(function (link) {
        const linkExist = (link.to == task && chds.indexOf(link.from) >= 0 || link.from == task && chds.indexOf(link.to) >= 0);
        return !linkExist;
    });

    //enlarge me if inherited children are larger
    for (i = 0; i < chds.length; i++) {
        //remove links from me to my new children
        chds[i].setPeriod(chds[i].start + 1, chds[i].end + 1);
    }

    //recompute depends string
    this.master.updateDependsStrings();

    //enlarge parent using a fake set period
    this.setPeriod(this.start + 1, this.end + 1);

    //force status check
    this.synchronizeStatus();
    return ret;
};

//<%------------------------------------------  MOVE UP / MOVE DOWN --------------------------------%>
Task.prototype.moveUp = function () {
    let ret = false;

    //a row above must exist
    const row = this.getRow();

    //no row no party
    if (row <= 0) {
        return false;
    }

    //find new row
    let newRow;
    for (newRow = row - 1; newRow >= 0; newRow--) {
        if (this.master.tasks[newRow].level <= this.level) {
            break;
        }
    }

    //is a parent or a brother
    if (this.master.tasks[newRow].level == this.level) {
        ret = true;
        //compute descendant
        let descNumber = 0;
        for (let i = row + 1; i < this.master.tasks.length; i++) {
            const desc = this.master.tasks[i];
            if (desc.level > this.level) {
                descNumber++;
            } else {
                break;
            }
        }

        //move in memory
        const blockToMove = this.master.tasks.splice(row, descNumber + 1);
        const top = this.master.tasks.splice(0, newRow);
        this.master.tasks = [].concat(top, blockToMove, this.master.tasks);
        //move on dom
        const rows = this.master.editor.element.find("tr[taskid]");
        const domBlockToMove = rows.slice(row, row + descNumber + 1);
        rows.eq(newRow).before(domBlockToMove);

        //recompute depends string
        this.master.updateDependsStrings();
    } else {
        this.master.setErrorOnTransaction(Gantt.messages["TASK_MOVE_INCONSISTENT_LEVEL"], this);
        ret = false;
    }
    return ret;
};

Task.prototype.moveDown = function () {
    //a row below must exist, and cannot move root task
    const row = this.getRow();
    if (row >= this.master.tasks.length - 1 || row == 0) {
        return false;
    }

    let ret = false;
    //find nearest brother
    let newRow;
    for (newRow = row + 1; newRow < this.master.tasks.length; newRow++) {
        if (this.master.tasks[newRow].level <= this.level) {
            break;
        }
    }

    //is brother
    if (this.master.tasks[newRow] && this.master.tasks[newRow].level == this.level) {
        ret = true;
        //find last desc
        for (newRow = newRow + 1; newRow < this.master.tasks.length; newRow++) {
            if (this.master.tasks[newRow].level <= this.level)
                break;
        }

        //compute descendant
        let descNumber = 0;
        for (let i = row + 1; i < this.master.tasks.length; i++) {
            const desc = this.master.tasks[i];
            if (desc.level > this.level) {
                descNumber++;
            } else {
                break;
            }
        }

        //move in memory
        const blockToMove = this.master.tasks.splice(row, descNumber + 1);
        const top = this.master.tasks.splice(0, newRow - descNumber - 1);
        this.master.tasks = [].concat(top, blockToMove, this.master.tasks);

        //move on dom
        const rows = this.master.editor.element.find("tr[taskid]");
        const aft = rows.eq(newRow - 1);
        const domBlockToMove = rows.slice(row, row + descNumber + 1);
        aft.after(domBlockToMove);

        //recompute depends string
        this.master.updateDependsStrings();
    }

    return ret;
};

Task.prototype.canStatusBeChangedTo = function (newStatus) {
    let i;
    let sups;
//lo stato corrente è sempre ok
    if (newStatus == this.status) {
        return true;
    }

    const parent = this.getParent();
    //---------------------------------------------------------------------- STATUS_DONE ----------------------------------------------------------------
    // un task può essere STATUS_DONE se di root
    // se il suo padre non è fallito o undefined
    // se non ha previouses aperti
    if ("STATUS_DONE" == newStatus) {
        if (!parent) {
            return true;
        }

        if ("STATUS_FAILED" == parent.status || "STATUS_UNDEFINED" == parent.status) {
            return false;
        }

        sups = this.getSuperiorTasks();
        for (i = 0; i < sups.length; i++) {
            if ("STATUS_DONE" != sups[i].status) { // è un errore se un predecessore non è chiuso
                return false;
            }
        }
        return true;

        //---------------------------------------------------------------------- STATUS_ACTIVE ----------------------------------------------------------------
        //un task può essere STATUS_ACTIVE se l'eventuale padre è active e se tutti i predecessori sono in STATUS_DONE
    } else if ("STATUS_ACTIVE" == newStatus) {
        if (!parent) {
            return true;
        }

        if (!"STATUS_ACTIVE" == parent.status) {
            return false;
        }

        sups = this.getSuperiorTasks();
        for (i = 0; i < sups.length; i++) {
            if ("STATUS_DONE" != sups[i].status) { // è un errore se un predecessore non è chiuso
                return false;
            }
        }
        return true;

        //---------------------------------------------------------------------- STATUS_WAITING ----------------------------------------------------------------
        //un task può essere STATUS_WAITING solo se ha il padre o un predecessore STATUS_WAITING || un predecessore active STATUS_ACTIVE
    } else if ("STATUS_WAITING" == newStatus) {
        //un task può essere STATUS_WAITING solo se ha il padre
        if (!parent) {
            return false;
        }

        if ("STATUS_FAILED" == parent.status || "STATUS_UNDEFINED" == parent.status) {
            return false;
        }

        if ("STATUS_WAITING" == parent.status) {
            return true;
        }

        sups = this.getSuperiorTasks();
        for (i = 0; i < sups.length; i++) {
            if ("STATUS_WAITING" == sups[i].status || "STATUS_ACTIVE" == sups[i].status) {
                return true;
            }
        }
        return false;

        //---------------------------------------------------------------------- STATUS_SUSPENDED ----------------------------------------------------------------
        //un task può essere is STATUS_SUSPENDED (a mano) se di root
        // se il parent è STATUS_ACTIVE o STATUS_SUSPENDED e se non
    } else if ("STATUS_SUSPENDED" == newStatus) {
        if (!parent) {
            return true;
        }

        if ("STATUS_UNDEFINED" == parent.status || "STATUS_FAILED" == parent.status) {
            return false;
        }

        return true;
        //---------------------------------------------------------------------- STATUS_FAILED ----------------------------------------------------------------
    } else if ("STATUS_FAILED" == newStatus) {
        //può essere in STATUS_FAILED sempre
        return true;
        //---------------------------------------------------------------------- STATUS_UNDEFINED ----------------------------------------------------------------
    } else if ("STATUS_UNDEFINED" == newStatus) {
        //può essere in STATUS_UNDEFINED sempre
        return true;
    }

    return false;
};

//<%------------------------------------------------------------------------  LINKS OBJECT ---------------------------------------------------------------%>
function Link(taskFrom, taskTo, lagInWorkingDays) {
    this.from = taskFrom;
    this.to = taskTo;
    this.lag = lagInWorkingDays;
}

//<%------------------------------------------------------------------------  ASSIGNMENT ---------------------------------------------------------------%>
function Assignment(id, resourceId, roleId, effort) {
    this.id = id;
    this.resourceId = resourceId;
    this.roleId = roleId;
    this.effort = effort;
}

//<%------------------------------------------------------------------------  RESOURCE ---------------------------------------------------------------%>
function Resource(id, name) {
    this.id = id;
    this.name = name;
}

//<%------------------------------------------------------------------------  ROLE ---------------------------------------------------------------%>
function Role(id, name) {
    this.id = id;
    this.name = name;
}