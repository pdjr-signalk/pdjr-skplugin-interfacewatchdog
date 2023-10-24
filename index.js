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

const fs = require('fs');

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
            "title": "Watchdog name",
            "type": "string"
          },
          "interface": {
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
          "restartLimit": {
            "title": "Maximum number of restart attempts",
            "type": "number"
          },
          "stopWatching": {
            "title": "Stop watching if reboot fails or is disabled",
            "type": "boolean"
          },
          "notificationPath": {
            "title": "Notification path",
            "type": "string"
          },
        },
        "required": [ "interface" ],
        "default": { 
          "threshold": 0,
          "waitForActivity": 2,
          "restartLimit": 3,
          "stopWatching": true
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
  
  plugin.start = function(options) {

    // Make plugin.options by merging defaults and options and dropping
    // any disabled interfaces (i.e where waitForActivity == 0).
    plugin.options = {};
    plugin.options.interfaces =
      options.interfaces
      .map(interface => ({ ...plugin.schema.properties.interfaces.items.default, ...{ name: interface.interface, notificationPath: `notifications.plugin.${plugin.id}.interfaces.${interface.name}` },  ...interface }))
      .filter(interface => (interface.waitForActivity != 0));

    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);

    // Get scratchData persisted over restarts
    plugin.scratchFile = require('path').join( app.getDataDirPath(), plugin.id + '.json');
    try { plugin.scratchData = require(plugin.scratchFile); } catch(e) { plugin.scratchData = {}; }
    plugin.options.interfaces.forEach(interface => {
      if (!plugin.scratchData[interface.name]) {
        plugin.scratchData[interface.name] = { notified: 0, activeCount: 0, inactiveCount: 0, restartCount: 0 }
      } else {
        plugin.scratchData[interface.name] = { ...plugin.scratchData[interface.name], ...{ notified: 0, activeCount: 0, inactiveCount: 0 } }
      }
    });

    // If we have some enabled interfaces then go into production.
    if (plugin.options.interfaces.length > 0) {

      // Report plugin status to dashboard and notify on each interface.
      log.N(`watching interface${(plugin.options.interfaces.length == 1)?'':'s'} ${plugin.options.interfaces.map(interface => (interface.name  + ((interface.restart)?'('+ ((interface.scratchpad.restartCount > 0)?'R':'r') + ')':''))).join(', ')}`);
      plugin.options.interfaces.forEach(interface => {
        App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Waiting for interface to become active' }, plugin.id);
      });  

      // Register as a serverevent recipient.
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          // Get throughput statistics for all configured interfaces
          const interfaceThroughputs =
            Object.keys(e.data.providerStatistics)
            .filter(key => plugin.options.interfaces.map(interface => interface.interface).includes(key))
            .reduce((a,key) => { a[key] = e.data.providerStatistics[key].deltaRate; return(a); }, {});
          app.debug(`interface throughputs: ${JSON.stringify(interfaceThroughputs)}`)

          // Iterate over configured interfaces.
          for (var i = plugin.options.interfaces.length - 1; i >= 0; i--) {
            var interface = plugin.options.interfaces[i]
            var throughput = (interfaceThroughputs[interface.interface])?interfaceThroughputs[interface.interface]:0;
            console.log(">>>>> %s", throughput);

            if (throughput > 0) { plugin.scratchData.activeCount++; } else { plugin.scratchData.inactiveCount++; }

            if (plugin.scratchData.activeCount == 1) {
              log.N(`interface '${interface.name}' is alive`);
              App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Interface is alive' }, plugin.id);
            }

            if (throughput <= interface.threshold) {
              if (plugin.scratchData.inactiveCount == interface.waitForActivity) {
                // We've waited long enough: either enter reboot cycle or disable
                if (interface.restartLimit != 0) {
                  if ((plugin.scratchData.restartCount < interface.restartLimit)) {
                    log.W(`interface '${interface.name}' ${(interface.activeCount)?' throughput is below threshold':'has not started'}: restarting system (attempt ${++plugin.scratchData.restartCount} of ${interface.restartLimit})`, false);
                    if (plugin.scratchData.notified == 1) {
                      App.notify(interface.notificationPath, { state: 'alert', method: [], message: 'Reboot recovery process started' }, plugin.id);
                      plugin.scratchData.notified = 2;
                    }
                    fs.writeFileSync(plugin.scratchFile, JSON.stringify(plugin.scratchData));
                    setTimeout(() => { process.exit(); }, 1000);
                  }
                } else {
                  if (plugin.options.stopWatching) {
                    log.W(`interface '${interface.name}' ${(interface.activeCount)?'has persistent low throughput':'has not started'} stopping watching`, false);
                    App.notify(interface.notificationPath, { state: 'warn', method: [], message: 'Interface is dead)' }, plugin.id);
                    plugin.scratchData.restartCount = 0;
                    fs.writeFileSync(plugin.scratchFile, JSON.stringify(plugin.scratchData));
                    plugin.options.interfaces.splice(i, 1);
                  }
                }
              }         
            } else {
              if (plugin.scratchData.notified == 2) {
                log.N(`interface '${interface.name}' throughput is above threshold`, false);
                App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Interface throughput is normal' }, plugin.id);
                plugin.scratchData.activeCount = plugin.scratchData.inactiveCount = plugin.scratchData.restartCount = 0;
                plugin.scratchData.notified = 1;
                fs.writeFileSync(plugin.scratchFile, JSON.stringify(plugin.scratchData));
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
