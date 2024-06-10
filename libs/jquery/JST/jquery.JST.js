$.fn.loadTemplates = function () {
    $.JST.loadTemplates($(this));
    return this;
};

$.JST = {
    _templates: {},
    _decorators: {},

    /**
     *
     * @param elems
     */
    loadTemplates: function (elems) {
        const COMMENT_NODE = 8;

        elems.each(function () {
            $(this).find(".__template__").each(function () {
                let templateBody;
                const tmpl = $(this);
                const type = tmpl.attr("type");

                //template may be inside <!-- ... --> or not in case of ajax loaded templates
                let found = false;
                let el = tmpl.get(0).firstChild;
                while (el && !found) {
                    if (el.nodeType === COMMENT_NODE) {
                        // this is inside the comment
                        templateBody = el.nodeValue;
                        found = true;
                        break;
                    }
                    el = el.nextSibling;
                }

                if (!found) {
                    // this is the whole template
                    templateBody = tmpl.html();
                }

                if (!templateBody.match(/##\w+##/)) { // is Resig' style? e.g. (#=id#) or (# ...some javascript code 'obj' is the alias for the object #)
                    const strFunc =
                        "var p=[],print=function(){p.push.apply(p,arguments);};" +
                        "with(obj){p.push('" +
                        templateBody.replace(/[\r\t\n]/g, " ")
                            .replace(/'(?=[^#]*#\))/g, "\t")
                            .split("'").join("\\'")
                            .split("\t").join("'")
                            .replace(/\(#=(.+?)#\)/g, "',$1,'")
                            .split("(#").join("');")
                            .split("#)").join("p.push('")
                        + "');}return p.join('');";
                    try {
                        $.JST._templates[type] = new Function("obj", strFunc);
                    } catch (e) {
                        console.error("JST error: " + type, e, strFunc);
                    }
                } else {
                    //plain template e.g. ##id##
                    try {
                        $.JST._templates[type] = templateBody;
                    } catch (e) {
                        console.error("JST error: " + type, e, templateBody);
                    }
                }
                tmpl.remove();
            });
        });
    },

    /**
     *
     * @param jsonData
     * @param template
     * @param transformToPrintable
     * @returns {jQuery|HTMLElement|*}
     */
    createFromTemplate: function (jsonData, template, transformToPrintable) {
        const templates = $.JST._templates;

        let jsData = {};
        if (transformToPrintable) {
            for (const prop in jsonData) {
                let value = jsonData[prop];
                if (typeof (value) == "string") {
                    value = (value + "").replace(/\n/g, "<br>");
                }
                jsData[prop] = value;
            }
        } else {
            jsData = jsonData;
        }

        function fillStripData(strip, data) {
            for (const prop in data) {
                const value = data[prop];

                strip = strip.replace(new RegExp("##" + prop + "##", "gi"), value);
            }

            // then clean the remaining ##xxx##
            return strip.replace(new RegExp("##\\w+##", "gi"), "");
        }

        let stripString;
        if (typeof (template) == "undefined") {
            alert("Template is required");
            stripString = "<div>Template is required</div>";
        } else if (typeof (templates[template]) == "function") { // resig template
            try {
                stripString = templates[template](jsData);// create a jquery object in memory
            } catch (e) {
                console.error("JST error: " + template, e.message);
                stripString = "<div> ERROR: " + template + "<br>" + e.message + "</div>";
            }
        } else {
            stripString = templates[template]; // recover strip template
            if (!stripString || stripString.trim().length === 0) {
                console.error("No template found for type '" + template + "'");
                return $("<div>");
            }
            stripString = fillStripData(stripString, jsData); //replace placeholders with data
        }

        // create a jquery object in memory
        const ret = $(stripString);
        // set __template attribute
        ret.attr("__template", template);

        //decorate the strip
        const dec = $.JST._decorators[template];
        if (typeof (dec) == "function") {
            dec(ret, jsData);
        }
        return ret;
    },

    /**
     *
     * @param template
     * @returns {*}
     */
    existsTemplate: function (template) {
        return $.JST._templates[template];
    },

    /**
     *
     * @param template
     * @param decorator
     */
    loadDecorator: function (template, decorator) {
        //decorate function is like function(domElement,jsonData){...}
        $.JST._decorators[template] = decorator;
    },

    /**
     *
     * @param template
     * @returns {*}
     */
    getDecorator: function (template) {
        return $.JST._decorators[template];
    },

    /**
     *
     * @param element
     */
    decorateTemplate: function (element) {
        const dec = $.JST._decorators[element.attr("__template")];
        if (typeof (dec) == "function") {
            //TODO: Possible bug, editor does not exist in scope [KNT]
            dec(editor);
        }
    },

    /**
     *
     * @param templateUrl
     * @param callback
     */
    ajaxLoadAsyncTemplates: function (templateUrl, callback) {
        $.get(templateUrl, (data) => {
            const div = $("<div>");
            div.html(data);
            $.JST.loadTemplates(div);
            if (typeof (callback) == "function") {
                callback();
            }
        }, "html");
    },

    /**
     *
     * @param templateUrl
     */
    ajaxLoadTemplates: function (templateUrl) {
        $.ajax({
            async: false,
            url: templateUrl,
            dataType: "html",
            success: function (data) {
                const div = $("<div>");
                div.html(data);
                $.JST.loadTemplates(div);
            }
        });
    }
};