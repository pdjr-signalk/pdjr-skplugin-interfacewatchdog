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
        "type": "object",
        "properties": {
          "name": {
            "title": "Interface name",
            "type": "string"
          },
          "threshold": {
            "title": "Activity threshold in deltas per second",
            "type": "number"
          },
          "waitForActivity": {
            "title": "Wait this number of cycles for activity (0 says for ever)",
            "type": "number"
          },
          "restart": {
            "title": "Restart",
            "type": "boolean"
          },
          "restartLimit": {
            "title": "Give up restarting the server after this many consecutive restarts",
            "type": "number"
          },
          "notificationPath": {
            "title": "Notification path",
            "type": "string"
          },
          "scratch": {
            "title": "Run-time scratchpad",
            "type": "object",
            "options": { "hidden": true },
            "properties": {
              "detectedActiveCount": {
                "type": "number"
              },
              "sequentialNotActiveCount": {
                "type": "number"
              },
              "alarmIssued": {
                "type": "number"
              },
              "restartCount": {
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
          "detectedActiveCount" : 0,
          "sequentialLowActiveCount": 0,
          "numberOfRestarts": 0,
          "alarmIssued": 0,
          "restartCount": 0
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
    app.debug(`using congiguration: ${JSON.stringify(plugin.options, null, 2)}`);
  
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

            if (throughput > 0) {
              interface.activeCount++;
              if (interface.activeCount == 1) {
                app.debug(`interface '${interface.name}' is alive`);
                App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Interface is alive' }, plugin.id);
              }
            } else {
              interface.inactiveCount++;
            }

            if (interface.activeCount == 0) {
              if (interface.inactiveCount > interface.inactiveLimit) {
              if (interface.restart) {
                if (interface.restartCount < interface.restartLimit) {
                  interface.restartCount++;
                  app.debug(`interface '${interface.name}' is dead: restarting Signal K (attempt ${interface.restartCount} of ${interface.restartLimit})`);
                  app.savePluginOptions(plugin.options);
                  process.exit();
                } else {
                  interface.restartCount = 0;
                  app.debug(`interface '${interface.name}' is dead: max restart attempts exceeded, so now ignoring`);
                  app.savePluginOptions(plugin.options);
                  plugin.options.interfaces.splice(i, 1);
                }
              } else {
                app.debug(`interface '${interface.name}' is dead: restart not configured, so now ignoring`);
                plugin.options.interfaces.splice(i, 1);
              }  
              }         
            } else {
              if (throughput < interface.threshold) {
              if (interface.restart) {
                app.debug(`interface '${interface.name}' throughput dropped below threshold: restarting`);
                process.exit();
              } else {
                app.debug(`interface '${interface.name}' throughput dropped below threshold`);
              }
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
