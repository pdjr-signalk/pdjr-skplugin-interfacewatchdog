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
const _ = require('lodash');

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
    "watchdogs": {
      "type": "array",
      "items": {
        "title": "Watchdog",
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
  "required": [ "watchdogs" ]
};
const PLUGIN_UISCHEMA = {};

module.exports = function(app) {
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = PLUGIN_SCHEMA;
  plugin.uiSchema = PLUGIN_UISCHEMA;

  const App = new myApp(app, plugin.id);
  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });
  
  plugin.start = function(options) {

    // Make plugin.options by merging defaults and options and dropping
    // any disabled watchdogs (i.e where waitForActivity == 0).
    plugin.options = {};
    plugin.options.watchdogs =
      options.watchdogs
      .map(watchdog => ({ ...plugin.schema.properties.watchdogs.items.default, ...{ name: watchdog.interface, notificationPath: `notifications.plugins.${plugin.id}.watchdogs.${watchdog.name}` },  ...watchdog }))
      .filter(watchdog => (watchdog.startActionThreshold != 0));

    // Get shadow options persisted over restarts
    plugin.shadowOptionsFilename = require('path').join( app.getDataDirPath(), 'shadow-options.json');
    var shadowOptions; 
    try { shadowOptions = require(plugin.shadowOptionsFilename); } catch(e) { shadowOptions = { watchdogs: [] }; }
    plugin.options.watchdogs = plugin.options.watchdogs.map(watchdog => {
      var shadowwatchdog = shadowOptions.watchdogs.reduce((a,i) => ((i.name == watchdog.name)?i:a), {});
      return({ ...{ problemCount: 0, state: 'waiting' }, ...shadowwatchdog, ...watchdog });    
    });
    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);

    // If we have some enabled watchdogs then go into production.
    if (plugin.options.watchdogs.length > 0) {

      // Report plugin status to dashboard and notify on each watchdog.
      var interfaces = _.sortedUniq(plugin.options.watchdogs.map(i => (i.interface)));
      log.N(`watching interface${(interfaces.length == 1)?'':'s'} ${interfaces.join(', ')}`);
      plugin.options.watchdogs.forEach(watchdog => {
        app.debug(`waiting for ${watchdog.name} on ${watchdog.interface} to become active`, false);
        App.notify(watchdog.notificationPath, { state: 'alert', method: [], message: 'Waiting for interface to become active' }, plugin.id);
      });  

      // Register as a serverevent recipient.
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          // Get throughput statistics for all configured watchdog
          const interfaceThroughputs =
            Object.keys(e.data.providerStatistics)
            .filter(key => plugin.options.watchdogs.map(watchdog => watchdog.interface).includes(key))
            .reduce((a,key) => { a[key] = e.data.providerStatistics[key].deltaRate; return(a); }, {});
          //app.debug(`interface throughputs: ${JSON.stringify(interfaceThroughputs)}`)

          // Iterate over configured watchdogs.
          for (var i = plugin.options.watchdogs.length - 1; i >= 0; i--) {
            var watchdog = plugin.options.watchdogs[i];
            var throughput = (interfaceThroughputs[watchdog.interface])?interfaceThroughputs[watchdog.interface]:0;

            if ((throughput > 0) && (watchdog.state == 'waiting')) watchdog.state = 'active';

            if (throughput <= watchdog.threshold) {
              watchdog.problemCount++;
              if (watchdog.problemCount == watchdog.startActionThreshold) watchdog.state = 'problem';
            } else {
              if (watchdog.state != 'normal') watchdog.state = 'newly-normal';
              watchdog.problemCount = 0;
            }

            app.debug(JSON.stringify(watchdog));

            switch (watchdog.state) {
              case 'waiting':
                break;
              case 'newly-normal':
                app.debug(`${watchdog.name} on ${watchdog.interface} started normal operation`, false);
                App.notify(watchdog.notificationPath, { state: 'normal', method: [], message: `Started normal operation` }, plugin.id);
                watchdog.state = 'normal';
                delete watchdog.restartCount;
                break;
              case 'normal':
                break;
              case 'problem':
                switch (watchdog.action) {
                  case 'restart-server':
                    if ((!watchdog.restartCount) || (watchdog.restartCount < (watchdog.stopActionThreshold - watchdog.startActionThreshold))) {
                      watchdog.restartCount = (watchdog.restartCount)?(watchdog.restartCount + 1):1;
                      app.debug(`${watchdog.name} on ${watchdog.interface} is triggering a server restart (${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold})`, false);
                      App.notify(watchdog.notificationPath, { state: 'alarm', method: [], message: `Server restart (${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold})` }, plugin.id);
                      setTimeout(() => { saveShadowOptions(); process.exit(); }, 1000);
                    } else {
                      watchdog.state = 'done';
                    }
                    break;
                  case 'kill-watchdog':
                    watchdog.state = 'done';
                    break;
                  default:
                    break;
                }
                break;
              case 'done':
                app.debug(`terminating watchdog on ${watchdog.name} on ${watchdog.interface}`, false);
                App.notify(watchdog.notificationPath, { state: 'warn', method: [], message: `Terminating watchdog` });
                delete watchdog.restartCount;
                saveShadowOptions();
                plugin.options.watchdogs.splice(i, 1);
                break;
            }
          }
        }
      })
    } else {
      log.W('stopped: no watchdogs are configured')
    }
  }

  plugin.stop = function() {
  }

  function saveShadowOptions() {
    var shadowStuff = {
      watchdogs: plugin.options.watchdogs.map(watchdog => ({ name: watchdog.name, restartCount: watchdog.restartCount }))
    };
    fs.writeFileSync(plugin.shadowOptionsFilename, JSON.stringify(shadowStuff));
  }

  return(plugin);
}
