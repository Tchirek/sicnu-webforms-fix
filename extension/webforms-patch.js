(function () {
  var version = "1.0.0";
  if (window.__sicnuWebFormsPatchVersion === version) {
    return;
  }

  window.__sicnuWebFormsPatchVersion = version;

  if (!window.WebForm_GetElementById) {
    window.WebForm_GetElementById = function (id) {
      return document.getElementById(id);
    };
  }

  if (!window.WebForm_GetElementByTagName) {
    window.WebForm_GetElementByTagName = function (element, tagName) {
      var nodes = (element || document).getElementsByTagName(tagName);
      return nodes.length ? nodes[0] : null;
    };
  }

  if (!window.WebForm_GetElementsByTagName) {
    window.WebForm_GetElementsByTagName = function (element, tagName) {
      return (element || document).getElementsByTagName(tagName);
    };
  }

  if (!window.WebForm_AppendToClassName) {
    window.WebForm_AppendToClassName = function (element, className) {
      if (!element || !className) {
        return;
      }

      var current = " " + (element.className || "") + " ";
      if (current.indexOf(" " + className + " ") < 0) {
        element.className = (element.className ? element.className + " " : "") + className;
      }
    };
  }

  if (!window.WebForm_RemoveClassName) {
    window.WebForm_RemoveClassName = function (element, className) {
      if (!element || !className) {
        return;
      }

      element.className = (" " + (element.className || "") + " ")
        .replace(" " + className + " ", " ")
        .replace(/^\s+|\s+$/g, "");
    };
  }

  if (!window.WebForm_GetElementDir) {
    window.WebForm_GetElementDir = function (element) {
      while (element && element !== document) {
        if (element.getAttribute) {
          var dir = element.getAttribute("dir");
          if (dir) {
            return dir;
          }
        }
        element = element.parentNode;
      }

      return document.dir || "ltr";
    };
  }

  if (!window.WebForm_GetElementPosition) {
    window.WebForm_GetElementPosition = function (element) {
      var rect = element.getBoundingClientRect();
      var scrollX = window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
      var scrollY = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

      return {
        x: rect.left + scrollX,
        y: rect.top + scrollY,
        width: rect.width || element.offsetWidth,
        height: rect.height || element.offsetHeight
      };
    };
  }

  if (!window.WebForm_SetElementX) {
    window.WebForm_SetElementX = function (element, x) {
      if (element) {
        element.style.left = x + "px";
      }
    };
  }

  if (!window.WebForm_SetElementY) {
    window.WebForm_SetElementY = function (element, y) {
      if (element) {
        element.style.top = y + "px";
      }
    };
  }

  if (!window.WebForm_SetElementWidth) {
    window.WebForm_SetElementWidth = function (element, width) {
      if (element) {
        element.style.width = width + "px";
      }
    };
  }

  if (!window.WebForm_SetElementHeight) {
    window.WebForm_SetElementHeight = function (element, height) {
      if (element) {
        element.style.height = height + "px";
      }
    };
  }

  if (!window.WebForm_PostBackOptions) {
    window.WebForm_PostBackOptions = function (
      eventTarget,
      eventArgument,
      validation,
      validationGroup,
      actionUrl,
      trackFocus,
      clientSubmit
    ) {
      this.eventTarget = eventTarget;
      this.eventArgument = eventArgument;
      this.validation = validation;
      this.validationGroup = validationGroup;
      this.actionUrl = actionUrl;
      this.trackFocus = trackFocus;
      this.clientSubmit = clientSubmit;
    };
  }

  if (!window.WebForm_DoPostBackWithOptions) {
    window.WebForm_DoPostBackWithOptions = function (options) {
      if (options && options.actionUrl) {
        var form = document.forms.form1 || document.form1;
        if (form) {
          form.action = options.actionUrl;
        }
      }

      if (!options || options.clientSubmit !== false) {
        window.__doPostBack(options ? options.eventTarget : "", options ? options.eventArgument : "");
      }
    };
  }

  if (!window.__doPostBack) {
    window.__doPostBack = function (eventTarget, eventArgument) {
      var theForm = document.forms.form1 || document.form1;
      if (!theForm) {
        return;
      }

      function hidden(name) {
        var element = theForm.elements[name] || document.getElementById(name);
        if (!element) {
          element = document.createElement("input");
          element.type = "hidden";
          element.name = name;
          element.id = name;
          theForm.appendChild(element);
        }
        return element;
      }

      hidden("__EVENTTARGET").value = eventTarget || "";
      hidden("__EVENTARGUMENT").value = eventArgument || "";
      theForm.submit();
    };
  }
})();
