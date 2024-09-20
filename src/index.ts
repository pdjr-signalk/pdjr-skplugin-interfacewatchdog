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

import { writeFileSync } from 'fs'
import * as _ from 'lodash'

const PLUGIN_ID: string = 'interfacewatchdog'
const PLUGIN_NAME: string = 'pdjr-skplugin-interfacewatchdog'
const PLUGIN_DESCRIPTION: string = 'Monitor Signal K interfaces for anomalous drops in activity'
const PLUGIN_SCHEMA: any = {
  "title": "Configuration for interfacewatchdog plugin",
  "type": "object",
  "properties": {
    "watchdogs": {
      "type": "array",
      "items": {
        "title": "Watchdog",
        "type": "object",
        "properties": {
          "interface": {
            "title": "Interface name",
            "type": "string"
          },
          "name": {
            "title": "Watchdog name",
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
            "enum": [ "none", "restart-server", "suspend-watchdog", "stop-watchdog" ]
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
          "action": "none"
        }
      }
    }
  },
  "required": [ "watchdogs" ]
}
const PLUGIN_UISCHEMA: any = {}

module.exports = function(app: any) {

  let heartbeat: number = 0
  let shadowOptionsFilename: string = ''
  let shadowOptions: ShadowOptions = {}

  const plugin: SKPlugin = {

    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    schema: PLUGIN_SCHEMA,
    uiSchema: PLUGIN_UISCHEMA,
    options: {},
  
    start: function(options: any) {
      shadowOptionsFilename = require('path').join(app.getDataDirPath(), 'shadow-options.json')

      if ((options.watchdogs) && (Array.isArray(options.watchdogs))) {
        const interfaceNumbers: Dictionary<number> = options.watchdogs.reduce((a: Dictionary<number>, w: Watchdog) => { if (w.interface) a[w.interface] = 0; return(a); }, {})
        plugin.options.watchdogs = options.watchdogs.reduce((a: Watchdog[], watchdog: Watchdog) => {
          try {
            var retval = { ...plugin.schema.properties.watchdogs.items.default, ...watchdog }
            retval.name = (watchdog.name)?watchdog.name:`${watchdog.interface}-${interfaceNumbers[watchdog.interface]++}`
            retval.stopActionThreshold = (watchdog.stopActionThreshold)?watchdog.stopActionThreshold:(retval.startActionThreshold + 3)
            retval.notificationPath = (watchdog.notificationPath)?(watchdog.notificationPath):`notifications.plugins.${plugin.id}.watchdogs.${retval.name}`
            if (!retval.interface) throw new Error("required property 'interface' is missing")
            if (!plugin.schema.properties.watchdogs.items.properties.action.enum.includes(retval.action)) throw new Error("property 'action' is invalid")
            if (retval.startActionThreshold <= 0) throw new Error("startActionThreshold is 0")
            a.push(retval)
          } catch(e: any) { app.debug(`dropping watchdog '${watchdog.name}' (${e.message})`); }
          return(a);
        }, []);
      }
      
      // We might be starting up in the middle of a restart sequence,
      // in which case a number of dynamic properties will be passed
      // forwards through the shadow options file. Also take this
      // opportunity to initialise various properties.
      try {
        shadowOptions = require(shadowOptionsFilename);
      } catch(e) {
        shadowOptions = { fileCreated: new Date().toISOString(), watchdogs: [] };
      }

      plugin.options.watchdogs = plugin.options.watchdogs.map((watchdog: Watchdog) => {
        let watchdogShadowOptions: WatchdogShadowOptions =
          (shadowOptions.watchdogs)
          ?shadowOptions.watchdogs.reduce((a: WatchdogShadowOptions, w: WatchdogShadowOptions) => ((w.name == watchdog.name)?w:a), {})
          :{};
        var combinedState = {
          ...{ problemsSinceFileCreation: 0 },
          ...watchdogShadowOptions,
          ...{ exceptionCount: 0, problemCount: 0, problemsSinceLastRestart: 0, stateHistory: [] },
          ...watchdog
        };
        return(combinedState)
      })

      // Set the initial state of each watchdog.
      plugin.options.watchdogs.forEach((watchdog: Watchdog) => { changeState(watchdog, 'starting'); })
    
      app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`)

      // If we have some enabled watchdogs then go into production.
      if (plugin.options.watchdogs.length > 0) {

        // Report plugin status to dashboard and notify startup of each
        // watchdog.
        let interfaces: string[] = _.sortedUniq(plugin.options.watchdogs.map((i: Watchdog) => (i.interface)))
        app.setPluginStatus(`watching interface${(interfaces.length == 1)?'':'s'} ${interfaces.join(', ')}`)
        plugin.options.watchdogs.forEach((watchdog: Watchdog) => {
          app.debug(`waiting for ${watchdog.name} on ${watchdog.interface} to become active`)
          console.log(watchdog.notificationPath, plugin.id);
          //app.notify(watchdog.notificationPath, { state: 'alert', message: 'Waiting for interface to become active' }, plugin.id)
        })

        // Register as a serverevent recipient - all substantive
        // processing happens in the event handler.
        app.on('serverevent', (e:  any) => {
          if ((e.type) && (e.type == "SERVERSTATISTICS")) {
            heartbeat++;

            // Get system throughput statistic for all interfaces that
            // are associated with a watchdog.
            const interfaceThroughputs: Dictionary<number> =
              Object.keys(e.data.providerStatistics)
                .filter((key: string) => plugin.options.watchdogs.map((watchdog: Watchdog) => watchdog.interface).includes(key))
                .reduce((a: Dictionary<number>, key: string) => { a[key] = e.data.providerStatistics[key].deltaRate; return(a); }, {})
            //app.debug(`interface throughputs: ${JSON.stringify(interfaceThroughputs)}`)

            // Iterate over configured watchdogs.
            for (var i: number = plugin.options.watchdogs.length - 1; i >= 0; i--) {
              var watchdog: Watchdog = plugin.options.watchdogs[i];
              var throughput: number = (interfaceThroughputs[watchdog.interface])?interfaceThroughputs[watchdog.interface]:0;

              // Count consecutive throughput exceptions and transition the
              // watchdog state to 'problem' if actionThreshold is reached
              // or to 'newly-normal' when a non-exception occurs. We use
              // newly-normal so that the state change can be logged once
              // before the immediate transition to 'normal'.
              if (throughput <= watchdog.threshold) {
                watchdog.exceptionCount++;
                if ((watchdog.exceptionCount == watchdog.startActionThreshold) && (!watchdog.state.startsWith('stop'))) watchdog.state = 'problem';
              } else {
                watchdog.exceptionCount = 0;
                if (watchdog.state != 'normal') watchdog.state = 'newly-normal';
              }

              //app.debug(JSON.stringify(watchdog));

              // Operate the state machine.
              switch (watchdog.state) {
                case 'starting':
                  break
                case 'newly-normal': // Transition to 'normal'
                  app.debug(`${watchdog.name} on ${watchdog.interface}: throughput moved above threshold`)
                  //app.notify(watchdog.notificationPath, { state: 'normal', message: `Throughput on ${watchdog.interface} moved above threshold.` }, plugin.id)
                  changeState(watchdog, 'normal')
                  delete watchdog.restartCount
                  break
                case 'normal':
                  break
                case 'problem':
                  watchdog.problemCount++
                  watchdog.problemsSinceFileCreation++
                  switch (watchdog.action) {
                    case 'restart-server':
                      if ((!watchdog.restartCount) || (watchdog.restartCount < (watchdog.stopActionThreshold - watchdog.startActionThreshold))) {
                        watchdog.restartCount = (watchdog.restartCount)?(watchdog.restartCount + 1):1
                        app.debug(`${watchdog.name} on ${watchdog.interface}: througput persistently below threshold: triggering restart ${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold}.`)
                        //app.notify(watchdog.notificationPath, { state: 'alarm', message: `Throughput on ${watchdog.interface} persistently below threshold: triggering restart ${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold}` }, plugin.id)
                        setTimeout(() => { saveShadowOptions(shadowOptionsFilename, plugin.options.watchdogs); process.exit(); }, 1000)
                      } else {
                        changeState(watchdog, 'suspend')
                      }
                      break
                    case 'stop-watchdog':
                      changeState(watchdog, 'stop')
                      break
                    case 'suspend-watchdog':
                      watchdog.state = 'suspend'
                    default:
                      break
                  }
                  break;
                case 'suspend': // Transition to 'suspended'
                  app.setPluginError(`${watchdog.name} on ${watchdog.interface}: suspending watchdog`)
                  //app.notify(watchdog.notificationPath, { state: 'warn', message: `Suspending watchdog until ${watchdog.interface} throughput rises above threshold.` }, plugin.id)
                  changeState(watchdog, 'suspended')
                  break
                case 'suspended':
                  break
                case 'stop': // Transition to 'stopped'
                  app.setPluginError(`${watchdog.name} on ${watchdog.interface}: terminating watchdog`, false)
                  //app.notify(watchdog.notificationPath, { state: 'warn', message: `Terminating watchdog on ${watchdog.interface}` }, plugin.id)
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
        app.setPluginError('stopped: no watchdogs are configured')
      }
    },

    stop: function() {
      saveShadowOptions(shadowOptionsFilename, plugin.options.watchdogs);
    },

    registerWithRouter: function(router) {
      router.get('/status', handleRoutes)
    },

    getOpenApi: function() {
      return(() => require("../resources/openApi.json"))
    }

  }

  return plugin

  function changeState(watchdog: Watchdog, state: string) {
    watchdog.state = state
    watchdog.stateHistory.push(`${(new Date()).toISOString().slice(0,19)} ${heartbeat} ${watchdog.exceptionCount} ${state}`)
  }

  function saveShadowOptions(filename: string, watchdogs: Watchdog[]) {
    var shadowOptions: ShadowOptions = {
      fileCreated: (new Date()).toISOString(),
      watchdogs: watchdogs.map((watchdog: Watchdog) => {
        return({
          name: watchdog.name,
          problemsInLastSession: watchdog.problemsSinceLastRestart,
          problemsSinceFileCreation: watchdog.problemsSinceFileCreation,
          restartCount: watchdog.restartCount
        })
      })
    }
    writeFileSync(filename, JSON.stringify(shadowOptions))
  }

  function handleRoutes(req: any, res: any) {
    app.debug("processing %s request on %s", req.method, req.path);
    try {
      switch (req.path.slice(0, (req.path.indexOf('/', 1) == -1)?undefined:req.path.indexOf('/', 1))) {
        case '/status':
          const status = plugin.options.watchdogs.reduce((a: any, watchdog: Watchdog) => {
            a[watchdog.name] = {
              interface: watchdog.interface,
              threshold: watchdog.threshold,
              currentState: watchdog.state,
              exceptionRate: `${watchdog.exceptionCount} / ${heartbeat}`,
              stateHistory: watchdog.stateHistory
            }
            return(a)
          }, {})
          expressSend(res, 200, status, req.path)
          break
      }
    } catch(e: any) {
      app.debug(e.message)
      expressSend(res, ((/^\d+$/.test(e.message))?parseInt(e.message):500), null, req.path)
    }
  
    function expressSend(res: any, code: number, body: any = null, debugPrefix: any = null) {
      const FETCH_RESPONSES: Dictionary<string | null> = { "200": null, "201": null, "400": "bad request", "403": "forbidden", "404": "not found", "503": "service unavailable (try again later)", "500": "internal server error" }
      res.status(code).send((body)?body:((FETCH_RESPONSES['' + code])?FETCH_RESPONSES['' + code]:null))
      if (debugPrefix) app.debug("%s: %d %s", debugPrefix, code, ((body)?JSON.stringify(body):((FETCH_RESPONSES['' + code])?FETCH_RESPONSES['' + code]:null)))
      return(false);
    }

  }
  
}

interface SKPlugin {
  id: string,
  name: string,
  description: string,
  schema: any,
  uiSchema: any,

  start: (options: any) => void,
  stop: () => void,
  registerWithRouter: (router: any) => void,
  getOpenApi: any,

  options: any
}

interface Watchdog {
  interface: string,
  name: string,
  threshold: number,
  startActionThreshold: number,
  stopActionThreshold: number,
  action: string,
  notificationPath: string,

  state: string,
  stateHistory: string[],

  exceptionCount: number,
  restartCount?: number,
  problemCount: number,
  problemsSinceLastRestart: number,
  problemsSinceFileCreation: number
}

interface WatchdogShadowOptions {
  name?: string,
  problemsInLastSession?: number,
  problemsSinceFileCreation?: number,
  restartCount?: number | undefined
}

interface ShadowOptions {
  fileCreated?: string,
  watchdogs?: WatchdogShadowOptions[]
}

interface Dictionary<T> {
  [key: string]: T  
}
