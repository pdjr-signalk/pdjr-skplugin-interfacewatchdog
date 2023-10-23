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

const myApp = require('./lib/signalk-libapp/App.js');
const Log = require('./lib/signalk-liblog/Log.js');

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
        "title": "Interface",
        "type": "object",
        "properties": {
          "name": {
            "title": "Interface name",
            "type": "string"
          },
          "threshold": {
            "title": "Activity threshold in deltas/s",
            "type": "number"
          },
          "waitForActivity": {
            "title": "Wait this number of cycles for activity",
            "type": "number"
          },
          "restart": {
            "title": "Restart",
            "type": "boolean"
          },
          "restartLimit": {
            "title": "Maximum allowed number of restart attempts",
            "type": "number"
          },
          "notificationPath": {
            "title": "Notification path",
            "type": "string"
          },
          "scratchpad": {
            "title": "Run-time scratchpad",
            "type": "object",
            "options": { "hidden": true },
            "properties": {
              "activeCount": {
                "type": "number"
              },
              "inactiveCount": {
                "type": "number"
              },
              "restartCount": {
                "type": "number"
              },
              "notified": {
                "type": "number"
              }
            }
          }
        },
        "required": [ "name" ],
        "default": { 
          "threshold": 0,
          "waitForActivity": 0,
          "restart": false,
          "restartLimit": 3,
          "scratchpad": {
            "activeCount" : 0,
            "inactiveCount": 0,
            "restartCount": 0,
            "notified": 0
          }
        }
      }
    }
  },
  "required": [ "interfaces" ]
};
const PLUGIN_UISCHEMA = {};

module.exports = function(app) {
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = PLUGIN_SCHEMA;
  plugin.uiSchema = PLUGIN_UISCHEMA;

  const App = new myApp(app);
  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });
  
  plugin.start = function(options, restartCallback) {

    // Make plugin.options by merging defaults and options.
    plugin.options = {};
    plugin.options.interfaces = options.interfaces.map(interface => ({ ...plugin.schema.properties.interfaces.items.default, ...interface }));
    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);
  
    if (plugin.options.interfaces.length > 0) {
      log.N(`watching interfaces ${JSON.stringify(plugin.options.interfaces.map(interface => (interface.name)))}`);
        
      plugin.options.interfaces.forEach(interface => {
        App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Waiting for interface to become active' }, plugin.id);
      });
            
      // Register as a serverevent recipient.
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          // Iterate over configured interfaces.
          for (var i = plugin.options.interfaces.length - 1; i >= 0; i--) {
            const interface = plugin.options.interfaces[i]
            const throughput = (e.data.providerStatistics[interface.name])?e.data.providerStatistics[interface.name].deltaRate:0;
            app.debug(`interface '${interface.name}' reports ${throughput} deltas/s throughput`);
            if (throughput > 0) {
              interface.scratchpad.activeCount++;
              if (interface.scratchpad.activeCount == 1) {
                app.debug(`interface '${interface.name}' is alive`);
                App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Interface is alive' }, plugin.id);
              }
            } else {
              interface.scratchpad.inactiveCount++;
            }

            if (throughput < interface.threshold) {
              // Interface has never been active
              if (interface.scratchpad.inactiveCount == interface.waitForActivity) {
                // We've waited long enough: either enter reboot cycle or disable
                if ((interface.restart) && (interface.scratchpad.restartCount < interface.restartLimit)) {
                  log.W(`interface '${interface.name}' ${(interface.activeCount)?' throughput is below threshold':'has not started'}: restarting system (attempt ${++interface.scratchpad.restartCount} of ${interface.restartLimit})`);
                  interface.scratchpad.inactiveCount = 0;
                  if ((interface.scratchpad.restartCount == 1) && (interface.scratchpad.notified == 0)) {
                    App.notify(interface.notificationPath, { state: 'alert', method: [], message: 'Reboot recovery process started' }, plugin.id);
                    interface.scratchpad.notified = 1;
                  }
                  app.savePluginOptions(plugin.options, () => { app.debug(`saved options ${JSON.stringify(plugin.options)}`); });
                  setTimeout(() => { process.exit(); }, 1000);
                } else {
                  log.W(`interface '${interface.name}' ${(interface.activeCount)?'has persistent low throughput':'has not started'} and will now be ignored`);
                  App.notify(interface.notificationPath, { state: 'warn', method: [], message: 'Monitoring disabled (interface is dead)' }, plugin.id);
                  interface.scratchpad.notified = interface.scratchpad.restartCount = interface.scratchpad.inactiveCount = 0;
                  app.savePluginOptions(plugin.options, () => { app.debug(`saved options ${JSON.stringify(plugin.options)}`); });
                  plugin.options.interfaces.splice(i, 1);
                }
              }         
            } else {
              if (interface.scratchpad.notified == 1) {
                App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Throughput above threshold' }, plugin.id);
                interface.scratchpad.notified = 0;
                app.savePluginOptions(plugin.options, () => { app.debug(`saved options ${JSON.stringify(plugin.options)}`); });
              }
            }
          }
        }
      })
    } else {
      log.W('stopped: no interfaces are configured')
    }
  }

  plugin.stop = function() {
  }

  return(plugin);
}
