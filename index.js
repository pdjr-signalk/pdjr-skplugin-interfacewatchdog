/**********************************************************************
 * Copyright 2022 Paul Reeve <preeve@pdjr.eu>
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you
 * may not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

const Log = require("./lib/signalk-liblog/Log.js");
const Notification = require("./lib/signalk-libnotification/Notification.js");

const PLUGIN_ID = "interfacewatchdog";
const PLUGIN_NAME = "Interface activity watchdog";
const PLUGIN_DESCRIPTION = "Monitor a Signal K interface for anomalous drops in activity";
const PLUGIN_SCHEMA = {
  "title": "Configuration for interfacewatchdog plugin",
  "type": "object",
  "properties": {
    "interfaces": {
      "type": "array",
      "items": {
        "type": "opject",
        "required": [ "interface", "threshold", "restart" ],
        "properties": {
          "interface": {
            "title": "Interface",
            "type": "string"
          },
          "threshold": {
            "title": "Threshold",
            "type": "number"
          },
          "restart": {
            "title": "Restart",
            "type": "boolean"
          },
          "notificationpath": {
            "title": "Notification path",
            "type": "string"
          }
        }
      }
    }
  }
};
const PLUGIN_UISCHEMA = {};

const OPTIONS_DEFAULT = {
  "interfaces": [
    { "interface": "n2k-on-ve.can-socket", "threshold": 0, "restart": true }
  ]
};

module.exports = function(app) {
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = PLUGIN_SCHEMA;
  plugin.uiSchema = PLUGIN_UISCHEMA;

  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });
  const notification = new Notification(app, plugin.id, { "state": "alarm", "method": [ ] });

  plugin.start = function(options) {

    if (Object.keys(options).length === 0) { // Config file is missing
      options = OPTIONS_DEFAULT;
      app.savePluginOptions(options, () => log.N("using default configuration (and saving it to disk)"));
    } else {
      if ((options.interface) && (options.threshold) && (options.restart) && (options.notification)) {
        options.interfaces = [{ "interface": options.interface, "threshold": options.threshold, "reboot": options.reboot, "notification": options.notification }];
        delete options.interface;
        delete options.threshold;
        delete options.restart;
        delete options.notification;
        app.savePluginOptions(options, () => log.N("using legacy configuration (and saving updated version to disk)"));
      }
    }
  
    if (options.interfaces) {
      log.N("monitoring %d interface%s (see log for configuration details)", options.interfaces.length, (options.interfaces.length == 1)?"":"s");
      
      options.interfaces.forEach(interface => {
        interface.hasBeenActive = 0;
        interface.alarmIssued = 0;
        interface.notificationpath = (interface.notificationpath)?interface.notificationpath:("notifications." + PLUGIN_ID + "." + interface.interface);
        log.N("monitoring '%s' interface (threshold = %d, reboot = %s)", interface.interface, interface.threshold, interface.restart, false);
        notification.issue(interface.notificationpath, "Waiting for interface to become active", { "state": "normal" });
      });
            
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          options.interfaces.forEach(interface => {
            if (e.data.providerStatistics[interface.interface].deltaRate !== undefined) {
              var throughput = e.data.providerStatistics[interface.interface].deltaRate;

              // Check interface to make sure it has some activity
              if ((interface.hasBeenActive == 0) && (throughput > 0.0)) {
                log.N("interface '%s' is alive, watchdog active", interface.interface, false);
                interface.hasBeenActive = 1;
              }
                  
              // If interface is active, then monitor throughput
              if (interface.hasBeenActive == 1) {
                if (parseInt(throughput) <= interface.threshold) {
                  log.N("throughput on '%s' dropped below threshold", interface.interface, false);
                  if (!interface.alarmIssued) {
                    notification.issue(interface.notificationpath, "Throughput on '" + interface.interface + "' dropped below threshold", { "state": "alarm" });
                    interface.alarmIssued = 1;
                  }
                  if (interface.restart) {
                    log.N("restarting Signal K", false);
                    setTimeout(() => { process.exit(0); }, 1000);
                  } 
                } else {
                  notification.issue(interface.notificationpath, "Throughput on '" + interface.interface + "' above threshold", { "state": "normal" });
                  interface.alarmIssued = 0;
                }
              }
            }
          });
        }
      });
    } else {
      log.E("bad or missing configuration");
    }
  }

  plugin.stop = function() {
  }

  return(plugin);
}
