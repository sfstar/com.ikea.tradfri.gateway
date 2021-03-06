'use strict';

const   Homey                   = require('homey'),
        node_tradfri_client     = require("node-tradfri-client");

const lightDriverName = "light";
const groupDriverName = "group";

class IkeaTradfriGatewayApp extends Homey.App {
    
    onInit() {
        this._gatewayConnected = false;
        this._homeyLightDriver = Homey.ManagerDrivers.getDriver(lightDriverName);
        this._homeyGroupDriver = Homey.ManagerDrivers.getDriver(groupDriverName);
        this._lights = {};
        this._groups = {};
        this._groupScenes = {};

        (async (args, callback) => {
            try {
                await this.connect();
            } catch (err) {
                this.log(err.message);
            }
        })();

        new Homey.FlowCardAction('setScene')
            .register()
            .registerRunListener( this._onFlowActionSetScene.bind(this) )
            .getArgument('scene')
            .registerAutocompleteListener( this._onSceneAutoComplete.bind(this) );

        this.log(`Tradfri Gateway App has been initialized`);
    }

    async discover() {
            return node_tradfri_client.discoverGateway();
    }

    async authenticate(name, securityCode) {
        let client = new node_tradfri_client.TradfriClient(name);
        return client.authenticate(securityCode);
    }

    async connect()
    {
        this._gatewayConnected = false;
        if (this._tradfri != null) {
            this._tradfri.destroy();
        }
        this._tradfri = new node_tradfri_client.TradfriClient(Homey.ManagerSettings.get('name'), {
            watchConnection: {
                pingInterval: 10000,
                failedPingCountUntilOffline: 1,
                failedPingBackoffFactor: 1.5,
                reconnectionEnabled: true,
                offlinePingCountUntilReconnect: 3,
                // maximumReconnects: 3, // default is infinite
                connectionInterval: 10000,
                maximumConnectionAttempts: 1, //default is infinite
                failedConnectionBackoffFactor: 1.5
            }
        });
        this._tradfri
            //.on("ping failed", (count) => this.log(`${count} pings failed`))
            //.on("ping succeeded", () => this.log("ping succeeded"))
            .on("connection lost", () => this.log("connection lost"))
            .on("connection failed", (att, max) => this.log(`connection failed: attempt ${att} of ${max}`))
            .on("connection alive", () => this.log("connection alive"))
            .on("gateway offline", () => this.log("gateway offline"))
            .on("reconnecting", (att, max) => this.log(`reconnect attempt ${att} of ${max}`))
            .on("give up", () => this.log("giving up..."))
            .on("device updated", this._deviceUpdated.bind(this))
            .on("device removed", this._deviceRemoved.bind(this))
            .on("group updated", this._groupUpdated.bind(this))
            .on("group removed", this._groupRemoved.bind(this))
            .on("scene updated", this._sceneUpdated.bind(this))
            .on("scene removed", this._sceneRemoved.bind(this));
        await this._tradfri.connect(Homey.ManagerSettings.get('identity'), Homey.ManagerSettings.get('psk'));
        this._gatewayConnected = true;
        this._tradfri.observeDevices();
        this._tradfri.observeGroupsAndScenes();
    }

    isGatewayConnected() {
        return this._gatewayConnected;
    }

    getLight(tradfriInstanceId) {
        return this._lights[tradfriInstanceId];
    }

    getLights() {
        return this._lights;
    }

    getGroup(tradfriInstanceId) {
        return this._groups[tradfriInstanceId];
    }

    getGroups() {
        return this._groups;
    }

    getScenes(groupId) {
        return this._groupScenes[groupId];
    }

    operateLight(tradfriInstanceId, commands) {
        let acc = this._lights[tradfriInstanceId];
        if (typeof acc !== "undefined")
            return this._tradfri.operateLight(acc, commands);

        return Promise.reject("light not found");
    }

    operateGroup(tradfriInstanceId, commands) {
        this.log('Sending command',commands);
        let group = this._groups[tradfriInstanceId];

        if (typeof group !== "undefined")
            return this._tradfri.operateGroup(group, commands, true);
        this.log(`Group with id ${tradfriInstanceId} not found`);
        return Promise.reject("group not found");
    }

    _deviceUpdated(acc) {
        if (acc.type === node_tradfri_client.AccessoryTypes.lightbulb) {
            this.log(`${acc.name} updated`);
            this._lights[acc.instanceId] = acc;
            this._homeyLightDriver.updateCapabilities(acc);

            //Update dim values on group if lights are updated individually or through scene
            for (const [groupInstanceId, group] of Object.entries(this._groups)) {
                if (group.deviceIDs && group.deviceIDs.indexOf(acc.instanceId) > -1)
                    this._homeyGroupDriver.deviceInGroupUpdated(group);
            }
        }
    }

    _deviceRemoved(acc) {
        this.log(`${acc.name} removed`);
        if (acc.type === node_tradfri_client.AccessoryTypes.lightbulb) {
            delete this._lights[acc.instanceId];
        }
    }

    _groupUpdated(group) {
        this.log(`Group ${group.name} updated`);
        this._groups[group.instanceId] = group;
        this._homeyGroupDriver.updateCapabilities(group);
    }

    _groupRemoved(instanceId) {
        this.log(`Group ${instanceId} removed`);
        delete this._groups[instanceId];
    }

    _sceneUpdated(groupId, scene) {
        this.log(`Scene ${scene.name} updated`);
        if(!this._groupScenes[groupId])
            this._groupScenes[groupId] = {};
        this._groupScenes[groupId][scene.instanceId] = scene;
    }

    _sceneRemoved(groupId, instanceId) {
        this.log(`Scene ${instanceId} removed`);
        if(this._groupScenes[groupId])
            delete this._groupScenes[groupId][instanceId];
    }

    _onFlowActionSetScene( args ) {
        return this.operateGroup(args.group._tradfriInstanceId, { transitionTime:1, onOff:true, sceneId:args.scene.instanceId });
    }

    _onSceneAutoComplete( query, args ) {
        const scenes = this.getScenes(args.group._tradfriInstanceId);
        return Object.values(scenes).map(s => {
            return {instanceId: s.instanceId, name:s.name}
        });
    }
}
module.exports = IkeaTradfriGatewayApp;
