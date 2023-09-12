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
        "type": "object",
        "properties": {
          "interface": {
            "title": "Interface",
            "type": "string"
          },
          "threshold": {
            "title": "Threshold",
            "type": "number",
            "default": 0
          },
          "waitForActivity": {
            "title": "Wait for activity",
            "type": "boolean",
            "default": true
          },
          "restart": {
            "title": "Restart",
            "type": "boolean",
            "default": false
          },
          "notificationPath": {
            "title": "Notification path",
            "type": "string"
          }
        },
        "required": [ "interface" ]
      }
    }
  },
  "required": [ "interfaces" ]
};
const PLUGIN_UISCHEMA = {};

const INTERFACE_THRESHOLD_DEFAULT = 0;
const INTERFACE_RESTART_DEFAULT = false;

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

    plugin.options = { interfaces: [] };
    if ((options.interfaces) && (Array.isArray(options.interfaces)) && (options.interfaces.length > 0)) {
      options.interfaces.forEach(interface => {
        plugin.options.interfaces.push({
          interface: interface.interface,
          threshold: interface.threshold || plugin.schema.properties.interfaces.items.properties.threshold.default,
          waitForActivity: (interface.waitForActivity !== undefined)?interface.waitForActivity:plugin.schema.properties.interfaces.items.properties.waitForActivity.default,
          restart: (interface.restart !== undefined)?interface.restart:plugin.schema.properties.interfaces.items.properties.restart.default,
          notificationPath: interface.notificationPath || "notifications." + plugin.id + "." + interface.interface
        });
      });
    }
    console.log(JSON.stringify(plugin.options));
    app.savePluginOptions(plugin.options, ()=>{});
    
    if (plugin.options.interfaces.length > 0) {
      if (plugin.options.interfaces.length == 1) {
        log.N("watching interface '%s' (wait = %s, threshold = %d, reboot = %s)", plugin.options.interfaces[0].interface, plugin.options.interfaces[0].waitForActivity, plugin.options.interfaces[0].threshold, plugin.options.interfaces[0].restart);
      } else {
        log.N("watching %d interfaces (see log for details)", plugin.options.interfaces.length);
      }
      
      plugin.options.interfaces.forEach(interface => {
        interface.hasBeenActive = 0;
        interface.alarmIssued = 0;
        if (plugin.options.interfaces.length > 1) log.N("watching interface '%s' (wait = %s, threshold = %d, reboot = %s)", interface.interface, interface.waitForActivity, interface.threshold, interface.restart, false);
        notification.issue(interface.notificationPath, "Waiting for interface to become active", { "state": "normal" });
      });
            
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          plugin.options.interfaces.forEach(interface => {
            if ((e.data.providerStatistics[interface.interface]) && (e.data.providerStatistics[interface.interface])) {
              var throughput = e.data.providerStatistics[interface.interface].deltaRate;

              // Check interface to make sure it has some activity
              if ((interface.hasBeenActive == 0) && (throughput > 0.0)) {
                log.N("interface '%s' is alive, watchdog active", interface.interface, false);
                notification.issue(interface.notificationPath, "Interface is alive, watchdog is active", { "state": "normal" });
                interface.hasBeenActive = 1;
              }
                  
              // If interface is active, then monitor throughput
              if ((!interface.waitForActivity) || (interface.hasBeenActive == 1)) {
                if (parseInt(throughput) <= interface.threshold) {
                  log.N("throughput on '%s' dropped below threshold", interface.interface, false);
                  if (!interface.alarmIssued) {
                    notification.issue(interface.notificationPath, "Throughput on '" + interface.interface + "' dropped below threshold", { "state": "alarm" });
                    interface.alarmIssued = 1;
                  }
                  if (interface.restart) {
                    log.N("restarting Signal K", false);
                    setTimeout(() => { process.exit(0); }, 1000);
                  } 
                } else {
                  notification.issue(interface.notificationPath, "Throughput on '" + interface.interface + "' above threshold", { "state": "normal" });
                  interface.alarmIssued = 0;
                }
              }
            } else {
              app.debug("provider statistics for interface '%s' are not available", interface.interface);
            }
          });
        }
      });
    } else {
      log.W("no interfaces are defined");
    }
  }

  plugin.stop = function() {
  }

  return(plugin);
}
