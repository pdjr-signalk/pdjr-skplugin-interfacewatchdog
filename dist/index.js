"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const _ = require("lodash");
const signalk_libdelta_1 = require("signalk-libdelta");
const signalk_libpluginstatus_1 = require("signalk-libpluginstatus");
const DEFAULT_THRESHOLD = 0;
const DEFAULT_START_ACTION_THRESHOLD = 3;
const DEFAULT_STOP_ACTION_THRESHOLD_OFFSET = 3;
const DEFAULT_ACTION = 'none';
const SHADOW_OPTIONS_FILENAME = 'shadow-options.json';
const PLUGIN_ID = 'interfacewatchdog';
const PLUGIN_NAME = 'pdjr-skplugin-interfacewatchdog';
const PLUGIN_DESCRIPTION = 'Monitor Signal K interfaces for anomalous drops in activity';
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
                        "enum": ["none", "restart-server", "suspend-watchdog", "stop-watchdog"]
                    },
                    "notificationPath": {
                        "title": "Notification path",
                        "type": "string"
                    },
                },
                "required": ["interface"],
            }
        }
    },
    "required": ["watchdogs"]
};
const PLUGIN_UISCHEMA = {};
module.exports = function (app) {
    var pluginConfiguration = {};
    let heartbeat = 0;
    let shadowOptionsFilename = '';
    const plugin = {
        id: PLUGIN_ID,
        name: PLUGIN_NAME,
        description: PLUGIN_DESCRIPTION,
        schema: PLUGIN_SCHEMA,
        uiSchema: PLUGIN_UISCHEMA,
        start: function (options) {
            var delta = new signalk_libdelta_1.Delta(app, plugin.id);
            var pluginStatus = new signalk_libpluginstatus_1.PluginStatus(app, '');
            try {
                pluginConfiguration = makePluginConfiguration(options);
                app.debug(`using plugin configuration ${JSON.stringify(pluginConfiguration, null, 2)}`);
                // We might be starting up in the middle of a restart sequence,
                // in which case a number of dynamic properties will be passed
                // forwards through the shadow options file. Also take this
                // opportunity to initialise various properties.
                let shadowOptionsFilename = require('path').join(app.getDataDirPath(), SHADOW_OPTIONS_FILENAME);
                pluginConfiguration = updatePluginConfigurationFromShadowOptions(pluginConfiguration, shadowOptionsFilename);
                // Set the initial state of each watchdog.
                pluginConfiguration.watchdogs.forEach((watchdog) => { changeState(watchdog, 'starting'); });
                // If we have some enabled watchdogs then go into production.
                if (pluginConfiguration.watchdogs.length > 0) {
                    // Report plugin status to dashboard and notify startup of each
                    // watchdog.
                    let interfaces = _.sortedUniq(pluginConfiguration.watchdogs.map((i) => (i.name)));
                    pluginStatus.setDefaultStatus(`Started: ${pluginConfiguration.watchdogs.length} watchdog(s) on ${interfaces.length} interface(s)`);
                    pluginConfiguration.watchdogs.forEach((watchdog) => {
                        app.debug(`watchdog '${watchdog.name}' is waiting for interface '${watchdog.interface}' to become active`);
                        delta.addValue(watchdog.notificationPath, { state: 'alert', message: 'Waiting for interface to become active', method: [] }).commit().clear();
                    });
                    app.on('serverevent', (e) => { serverEventHandler(pluginConfiguration, e); });
                }
                else {
                    pluginStatus.setDefaultStatus('Stopped: no valid watchdog configurations');
                }
            }
            catch (e) {
                pluginStatus.setDefaultStatus('Stopped: bad or missing plugin configuration');
                app.setPluginError(e.message);
            }
        },
        stop: function () {
            saveShadowOptions(shadowOptionsFilename, pluginConfiguration.watchdogs);
        },
        registerWithRouter: function (router) {
            router.get('/status', handleRoutes);
        },
        getOpenApi: function () {
            return (require("./openApi.json"));
        }
    };
    function makePluginConfiguration(options) {
        const interfaceNumbers = options.watchdogs.reduce((a, w) => { if (w.interface)
            a[w.interface] = 0; return (a); }, {});
        var pluginConfiguration = {
            watchdogs: options.watchdogs.reduce((a, watchdogOptions) => {
                try {
                    if (!watchdogOptions.interface)
                        throw new Error('missing \'interface\' property');
                    var watchdog = {};
                    watchdog.name = watchdogOptions.name || `${watchdogOptions.interface}-${interfaceNumbers[watchdogOptions.interface]++}`;
                    watchdog.interface = watchdogOptions.interface;
                    watchdog.threshold = watchdogOptions.threshold || DEFAULT_THRESHOLD;
                    watchdog.startActionThreshold = watchdogOptions.startActionThreshold || DEFAULT_START_ACTION_THRESHOLD;
                    watchdog.stopActionThreshold = watchdogOptions.stopActionThreshold || (watchdog.startActionThreshold + DEFAULT_STOP_ACTION_THRESHOLD_OFFSET);
                    watchdog.action = watchdogOptions.action || DEFAULT_ACTION;
                    watchdog.notificationPath = watchdogOptions.notificationPath || `notifications.plugins.${plugin.id}.watchdogs.${watchdog.name}`;
                    a.push(watchdog);
                }
                catch (e) {
                    app.debug(`ignoring watchdog with ${e.message}`);
                }
                return (a);
            }, [])
        };
        return (pluginConfiguration);
    }
    function updatePluginConfigurationFromShadowOptions(pluginConfiguration, shadowOptionsFilename) {
        var shadowOptions;
        try {
            shadowOptions = require(shadowOptionsFilename);
        }
        catch (e) {
            shadowOptions = { fileCreated: new Date().toISOString(), watchdogs: [] };
        }
        pluginConfiguration.watchdogs = pluginConfiguration.watchdogs.map((watchdog) => {
            let watchdogShadowOptions = (shadowOptions.watchdogs)
                ? shadowOptions.watchdogs.reduce((a, w) => ((w.name == watchdog.name) ? w : a), {})
                : {};
            var updatedWatchdog = {
                ...{ problemsSinceFileCreation: 0 },
                ...watchdogShadowOptions,
                ...{ exceptionCount: 0, problemCount: 0, problemsSinceLastRestart: 0, stateHistory: [] },
                ...watchdog
            };
            return (updatedWatchdog);
        });
        return (pluginConfiguration);
    }
    function serverEventHandler(pluginConfiguration, e) {
        var delta = new signalk_libdelta_1.Delta(app, plugin.id);
        if ((e.type) && (e.type == "SERVERSTATISTICS")) {
            app.heartbeat++;
            // Get system throughput statistic for all interfaces that
            // are associated with a watchdog.
            const interfaceThroughputs = Object.keys(e.data.providerStatistics)
                .filter((key) => pluginConfiguration.watchdogs.map((watchdog) => watchdog.interface).includes(key))
                .reduce((a, key) => { a[key] = e.data.providerStatistics[key].deltaRate; return (a); }, {});
            //app.debug(`interface throughputs: ${JSON.stringify(interfaceThroughputs)}`)
            // Iterate over configured watchdogs.
            for (var i = pluginConfiguration.watchdogs.length - 1; i >= 0; i--) {
                var watchdog = pluginConfiguration.watchdogs[i];
                var throughput = (interfaceThroughputs[watchdog.interface]) ? interfaceThroughputs[watchdog.interface] : 0;
                // Count consecutive throughput exceptions and transition the
                // watchdog state to 'problem' if actionThreshold is reached
                // or to 'newly-normal' when a non-exception occurs. We use
                // newly-normal so that the state change can be logged once
                // before the immediate transition to 'normal'.
                if (throughput <= watchdog.threshold) {
                    watchdog.exceptionCount++;
                    if ((watchdog.exceptionCount == watchdog.startActionThreshold) && (!watchdog.state.startsWith('stop')))
                        watchdog.state = 'problem';
                }
                else {
                    watchdog.exceptionCount = 0;
                    if (watchdog.state != 'normal')
                        watchdog.state = 'newly-normal';
                }
                //app.debug(JSON.stringify(watchdog));
                // Operate the state machine.
                switch (watchdog.state) {
                    case 'starting':
                        break;
                    case 'newly-normal': // Transition to 'normal'
                        app.debug(`watchdog '${watchdog.name}' on '${watchdog.interface}': throughput moved above threshold`);
                        delta.addValue(watchdog.notificationPath, { state: 'normal', message: `Throughput on ${watchdog.interface} moved above threshold.`, method: [] }).commit().clear();
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
                                    watchdog.restartCount = (watchdog.restartCount) ? (watchdog.restartCount + 1) : 1;
                                    app.debug(`watchdog '${watchdog.name}' on '${watchdog.interface}': througput persistently below threshold: triggering restart ${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold}.`);
                                    delta.addValue(watchdog.notificationPath, { state: 'alarm', message: `Throughput on ${watchdog.interface} persistently below threshold: triggering restart ${watchdog.restartCount} of ${watchdog.stopActionThreshold - watchdog.startActionThreshold}`, method: [] }).commit().clear();
                                    setTimeout(() => { saveShadowOptions(shadowOptionsFilename, pluginConfiguration.watchdogs); process.exit(); }, 1000);
                                }
                                else {
                                    changeState(watchdog, 'suspend');
                                }
                                break;
                            case 'stop-watchdog':
                                changeState(watchdog, 'stop');
                                break;
                            case 'suspend-watchdog':
                                watchdog.state = 'suspend';
                            default:
                                break;
                        }
                        break;
                    case 'suspend': // Transition to 'suspended'
                        app.debug(`watchdog '${watchdog.name}' on '${watchdog.interface}': suspending watchdog`);
                        delta.addValue(watchdog.notificationPath, { state: 'warn', message: `Suspending watchdog until ${watchdog.interface} throughput rises above threshold.`, method: [] }).commit().clear();
                        changeState(watchdog, 'suspended');
                        break;
                    case 'suspended':
                        break;
                    case 'stop': // Transition to 'stopped'
                        app.debug(`watchdog '${watchdog.name}' on '${watchdog.interface}': terminating watchdog`, false);
                        delta.addValue(watchdog.notificationPath, { state: 'warn', message: `Terminating watchdog on ${watchdog.interface}`, method: [] }).commit().clear();
                        delete watchdog.restartCount;
                        changeState(watchdog, 'stopped');
                        break;
                    case 'stopped':
                        break;
                }
            }
        }
    }
    function changeState(watchdog, state) {
        watchdog.state = state;
        watchdog.stateHistory.push(`${(new Date()).toISOString().slice(0, 19)} ${heartbeat} ${watchdog.exceptionCount} ${state}`);
    }
    function saveShadowOptions(filename, watchdogs) {
        var shadowOptions = {
            fileCreated: (new Date()).toISOString(),
            watchdogs: watchdogs.map((watchdog) => {
                return ({
                    name: watchdog.name,
                    problemsInLastSession: watchdog.problemsSinceLastRestart,
                    problemsSinceFileCreation: watchdog.problemsSinceFileCreation,
                    restartCount: watchdog.restartCount
                });
            })
        };
        (0, fs_1.writeFileSync)(filename, JSON.stringify(shadowOptions));
    }
    function handleRoutes(req, res) {
        app.debug("processing %s request on %s", req.method, req.path);
        try {
            switch (req.path.slice(0, (req.path.indexOf('/', 1) == -1) ? undefined : req.path.indexOf('/', 1))) {
                case '/status':
                    const status = pluginConfiguration.watchdogs.reduce((a, watchdog) => {
                        a[watchdog.name] = {
                            interface: watchdog.interface,
                            threshold: watchdog.threshold,
                            currentState: watchdog.state,
                            exceptionRate: `${watchdog.exceptionCount} / ${heartbeat}`,
                            stateHistory: watchdog.stateHistory
                        };
                        return (a);
                    }, {});
                    expressSend(res, 200, status, req.path);
                    break;
            }
        }
        catch (e) {
            app.debug(e.message);
            expressSend(res, ((/^\d+$/.test(e.message)) ? parseInt(e.message) : 500), null, req.path);
        }
        function expressSend(res, code, body = null, debugPrefix = null) {
            const FETCH_RESPONSES = { "200": null, "201": null, "400": "bad request", "403": "forbidden", "404": "not found", "503": "service unavailable (try again later)", "500": "internal server error" };
            res.status(code).send((body) ? body : ((FETCH_RESPONSES['' + code]) ? FETCH_RESPONSES['' + code] : null));
            if (debugPrefix)
                app.debug("%s: %d %s", debugPrefix, code, ((body) ? JSON.stringify(body) : ((FETCH_RESPONSES['' + code]) ? FETCH_RESPONSES['' + code] : null)));
            return (false);
        }
    }
    return plugin;
};
