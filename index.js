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
    // any disabled watchdogs.
    const interfaceNumbers = options.watchdogs.reduce((a,w) => { a[w.interface] = 0; return(a); }, {});
    plugin.options = {};
    plugin.options.watchdogs =
      options.watchdogs
      .filter(watchdog => (watchdog.startActionThreshold != 0))
      .map(watchdog => {
        var retval = { ...plugin.schema.properties.watchdogs.items.default, ...watchdog };
        retval.name = (watchdog.name)?watchdog.name:(watchdog.interface + '-' + (interfaceNumbers[watchdog.interface]++));
        retval.notificationPath = (watchdog.notificationPath)?(watchdog.notificationPath):`notifications.plugins.${plugin.id}.watchdogs.${retval.name}`;
        return(retval);
      })
    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);

    // We might be starting up in the middle of a restart sequence,
    // in which case a number of dynamic properties will be passed
    // forwards through the shadow options file. Also take this
    // opportunity to initialise various properties.
    plugin.shadowOptionsFilename = require('path').join( app.getDataDirPath(), 'shadow-options.json');
    var shadowOptions; 
    try {
      shadowOptions = require(plugin.shadowOptionsFilename);
    } catch(e) {
      shadowOptions = { fileCreated: new Date().toString(), watchdogs: [] };
    }
    plugin.options.watchdogs = plugin.options.watchdogs.map(watchdog => {
      var shadowwatchdog = shadowOptions.watchdogs.reduce((a,i) => ((i.name == watchdog.name)?i:a), {});
      var combinedState = {
        ...{ problemsSinceFileCreation: 0 },
        ...shadowwatchdog,
        ...{ exceptionCount: 0, problemCount: 0, problemsSinceLastRestart: 0, stateHistory: [] },
        ...watchdog
      };
      return(combinedState);
    });

    // Initialise a counter of the number of time a server event calls us.
    plugin.heartbeat = 0;

    // Set the initial state of each watchdog.
    plugin.options.watchdogs.forEach(watchdog => { changeState(watchdog, 'starting'); });
    
    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);

    // If we have some enabled watchdogs then go into production.
    if (plugin.options.watchdogs.length > 0) {

      // Report plugin status to dashboard and notify startup of each
      // watchdog.
      var interfaces = _.sortedUniq(plugin.options.watchdogs.map(i => (i.interface)));
      log.N(`watching interface${(interfaces.length == 1)?'':'s'} ${interfaces.join(', ')}`);
      plugin.options.watchdogs.forEach(watchdog => {
        app.debug(`waiting for ${watchdog.name} on ${watchdog.interface} to become active`, false);
        App.notify(watchdog.notificationPath, { state: 'alert', method: [], message: 'Waiting for interface to become active' }, plugin.id);
      });  

      // Register as a serverevent recipient - all substantive
      // processing happens in the event handler.
      app.on('serverevent', (e) => {
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
          plugin.heartbeat++;

          // Get system throughput statistic for all interfaces that
          // are associated with a watchdog.
          const interfaceThroughputs =
            Object.keys(e.data.providerStatistics)
            .filter(key => plugin.options.watchdogs.map(watchdog => watchdog.interface).includes(key))
            .reduce((a,key) => { a[key] = e.data.providerStatistics[key].deltaRate; return(a); }, {});
          //app.debug(`interface throughputs: ${JSON.stringify(interfaceThroughputs)}`)

          // Iterate over configured watchdogs.
          for (var i = plugin.options.watchdogs.length - 1; i >= 0; i--) {
            var watchdog = plugin.options.watchdogs[i];
            var throughput = (interfaceThroughputs[watchdog.interface])?interfaceThroughputs[watchdog.interface]:0;

            // Count consecutive throughput exceptions and transition the
            // watchdog state to 'problem' if actionThreshold is reached
            // or to 'newly-normal' when a non-exception occurs. We use
            // newly-normal so that the state change can be logged once
            // before the immediate transition to 'normal'.
            if (throughput <= watchdog.threshold) {
              watchdog.exceptionCount++;
              if ((watchdog.exceptionCount == watchdog.startActionThreshold) && (!watchdog.state.startsWith('stop'))) changeState(watchdog, 'problem');
            } else {
              watchdog.exceptionCount = 0;
              if (watchdog.state != 'normal') watchdog.state = 'newly-normal';
            }

            //app.debug(JSON.stringify(watchdog));

            // Operate the state machine.
            switch (watchdog.state) {
              case 'starting':
                break;
              case 'newly-normal':
                app.debug(`${watchdog.name} on ${watchdog.interface} started normal operation`, false);
                App.notify(watchdog.notificationPath, { state: 'normal', method: [], message: `Started normal operation` }, plugin.id);
                changeState(watchdog, 'normal');
                delete watchdog.restartCount;
                break;
              case 'normal':
                break;
              case 'problem':
                watchdog.problemCount++;
                watchdog.problemsSinceFileCreation++;  
                switch (watchdog.action) {
                  case 'restart-server':
                    if ((!watchdog.restartCount) || (watchdog.restartCount < (watchdog.stopActionThreshold - watchdog.startActionThreshold))) {
                      watchdog.restartCount = (watchdog.restartCount)?(watchdog.restartCount + 1):1;
                      app.debug(`${watchdog.name} on ${watchdog.interface} is triggering a server restart (${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold})`, false);
                      App.notify(watchdog.notificationPath, { state: 'alarm', method: [], message: `Server restart (${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold})` }, plugin.id);
                      setTimeout(() => { saveShadowOptions(); process.exit(); }, 1000);
                    } else {
                      changeState(watchdog, 'stopping');
                    }
                    break;
                  case 'stop-watchdog':
                    changeState(watchdog, 'stopping');
                    break;
                  default:
                    break;
                }
                break;
              case 'stopping':
                app.debug(`terminating watchdog on ${watchdog.name} on ${watchdog.interface}`, false);
                App.notify(watchdog.notificationPath, { state: 'warn', method: [], message: `Terminating watchdog` });
                delete watchdog.restartCount;
                changeState(watchdog, 'stopped')
                break;
              case 'stopped':
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
    saveShadowOptions();
  }

  plugin.registerWithRouter = function(router) {
    router.get('/status', handleRoutes);
  }

  plugin.getOpenApi = function() {
    require("./resources/openApi.json");
  }

  /********************************************************************
   * Change watchdog state and log state change to stateHistory. 
   */
  function changeState(watchdog, state) {
    watchdog.state = state;
    watchdog.stateHistory.push(`${new Date().toISOString('YYYY-MM-DDTHH:mm:ss')} ${plugin.heartbeat} ${watchdog.exceptionCount} ${state}`);
  }

  /********************************************************************
   * Save persistent data to the shadowOptions file.
   */
  function saveShadowOptions() {
    var shadowStuff = {
      fileCreated: plugin.options.fileCreated,
      watchdogs: plugin.options.watchdogs.map(watchdog => ({ name: watchdog.name, problemsSinceFileCreation: watchdog.problemsSinceFileCreation, problemsInLastSession: watchdog.problemsSinceLastRestart, restartCount: watchdog.restartCount }))
    };
    fs.writeFileSync(plugin.shadowOptionsFilename, JSON.stringify(shadowStuff));
  }

  /********************************************************************
   * EXPRESS ROUTE HANDLING
   */

  function handleRoutes(req, res) {
    app.debug("processing %s request on %s", req.method, req.path);
    try {
      switch (req.path.slice(0, (req.path.indexOf('/', 1) == -1)?undefined:req.path.indexOf('/', 1))) {
        case '/status':
          const status = plugin.options.watchdogs.reduce((a,watchdog) => {
            a[watchdog.name] = {
              currentState: watchdog.state,
              exceptionRate: `${watchdog.exceptionCount} / ${plugin.heartbeat}`,
              stateHistory: watchdog.stateHistory
            }
            return(a);
          },{}); 
          expressSend(res, 200, status, req.path);
          break;
      }
    } catch(e) {
      app.debug(e.message);
      expressSend(res, ((/^\d+$/.test(e.message))?parseInt(e.message):500), null, req.path);
    }
  
    function expressSend(res, code, body = null, debugPrefix = null) {
      const FETCH_RESPONSES = { 200: null, 201: null, 400: "bad request", 403: "forbidden", 404: "not found", 503: "service unavailable (try again later)", 500: "internal server error" };
      res.status(code).send((body)?body:((FETCH_RESPONSES[code])?FETCH_RESPONSES[code]:null));
      if (debugPrefix) app.debug("%s: %d %s", debugPrefix, code, ((body)?JSON.stringify(body):((FETCH_RESPONSES[code])?FETCH_RESPONSES[code]:null)));
      return(false);
    }

  }
  
  return(plugin);
}
