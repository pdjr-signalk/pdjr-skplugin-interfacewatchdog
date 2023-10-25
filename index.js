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
const internal = require('stream');

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
            "title": "Throughput threshold in deltas/s",
            "type": "number"
          },
          "startActionThreshold": {
            "title": "Start taking action after this many problems",
            "type": "number"
          },
          "stopActionThreshold": {
            "title": "Stop taking action after this many problems",
            "type": "number"
          },
          "action": {
            "title": "Action to take",
            "type": "string",
            "enum": [ "none", "kill-watchdog", "restart-server" ]
          },
          "notificationPath": {
            "title": "Notification path",
            "type": "string"
          },
        },
        "required": [ "interface" ],
        "default": { 
          "threshold": 0,
          "startActionThreshold": 3,
          "stopActionThreshold": 6,
          "action": "none"
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
      .filter(interface => (interface.startActionThreshold != 0));

    // Get shadow options persisted over restarts
    plugin.shadowOptionsFilename = require('path').join( app.getDataDirPath(), 'shadow-options.json');
    var shadowOptions; 
    try { shadowOptions = require(plugin.shadowOptionsFilename); } catch(e) { shadowOptions = { interfaces: [] }; }
    plugin.options.interfaces = plugin.options.interfaces.map(interface => {
      var shadowInterface = shadowOptions.interfaces.reduce((a,i) => ((i.name == interface.name)?i:a), {});
      return({ ...{ problemCount: 0, state: 'waiting' }, ...shadowInterface, ...interface });    
    });
    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);

    // If we have some enabled interfaces then go into production.
    if (plugin.options.interfaces.length > 0) {

      // Report plugin status to dashboard and notify on each interface.
      log.N(`watching interface${(plugin.options.interfaces.length == 1)?'':'s'} ${plugin.options.interfaces.map(interface => (interface.name)).join(', ')}`);
      plugin.options.interfaces.forEach(interface => {
        log.N(`waiting for ${interface.name} to become active`, false);
        App.notify(interface.notificationPath, { state: 'normal', method: [], message: 'Waiting for interface to become active' }, plugin.id);
      });  

      // Register as a serverevent recipient.
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          // Get throughput statistics for all configured interface
          const interfaceThroughputs =
            Object.keys(e.data.providerStatistics)
            .filter(key => plugin.options.interfaces.map(interface => interface.interface).includes(key))
            .reduce((a,key) => { a[key] = e.data.providerStatistics[key].deltaRate; return(a); }, {});
          //app.debug(`interface throughputs: ${JSON.stringify(interfaceThroughputs)}`)

          // Iterate over configured interfaces.
          for (var i = plugin.options.interfaces.length - 1; i >= 0; i--) {
            var interface = plugin.options.interfaces[i];
            var throughput = (interfaceThroughputs[interface.interface])?interfaceThroughputs[interface.interface]:0;

            if ((throughput > 0) && (interface.state == 'waiting')) interface.state = 'active';

            if (throughput <= interface.threshold) {
              interface.problemCount++;
              if (interface.problemCount == interface.startActionThreshold) interface.state = 'problem';
            } else {
              if (interface.state != 'normal') interface.state = 'newly-normal';
              interface.problemCount = 0;
            }

            app.debug(JSON.stringify(interface));

            switch (interface.state) {
              case 'waiting':
                break;
              case 'newly-normal':
                log.N(`${interface.name} entered normal operation`, false);
                App.notify(interface.notificationPath, { state: 'normal', method: [], message: `${interface.name} entered normal operation` }, plugin.id);
                interface.state = 'normal';
                delete interface.restartCount;
                break;
              case 'normal':
                break;
              case 'problem':
                switch (interface.action) {
                  case 'restart-server':
                    if ((!interface.restartCount) || (interface.restartCount < (interface.stopActionThreshold - interface.startActionThreshold))) {
                      interface.restartCount = (interface.restartCount)?(interface.restartCount + 1):1;
                      log.W(`${interface.name} triggering server restart (${interface.restartCount} of ${interface.stopActionThreshold - interface.startActionThreshold})`, false);
                      App.notify(interface.notificationPath, { state: 'alert', method: [], message: `Server restart (${interface.restartCount} of ${interface.stopActionThreshold - interface.startActionThreshold})` }, plugin.id);
                      setTimeout(() => { saveShadowOptions(); process.exit(); }, 1000);
                    } else {
                      interface.state = 'done';
                    }
                    break;
                  case 'kill-watchdog':
                    interface.state = 'done';
                    break;
                  default:
                    break;
                }
                break;
              case 'done':
                log.W(`terminating watchdog on ${interface.name}`, false);
                App.notify(interface.notificationPath, { state: 'warn', method: [], message: `Terminating watchdog` });
                delete interface.restartCount;
                saveShadowOptions();
                plugin.options.interfaces.splice(i, 1);
                break;
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

  function saveShadowOptions() {
    var shadowStuff = {
      interfaces: plugin.options.interfaces.map(interface => ({ name: interface.name, restartCount: interface.restartCount }))
    };
    fs.writeFileSync(plugin.shadowOptionsFilename, JSON.stringify(shadowStuff));
  }

  return(plugin);
}
