const { views } = require("../bootstraps/views.js");
const { padNumber } = require("../utils/format.js");

class ViewFlow {
    // prettier-ignore
    constructor({
        state,
        config
    }) {
        this.state = state;
        this.config = config;
        this.viewFlow = this.buildViewFlow();
    }

    // prettier-ignore
    buildViewFlow() {
        const testViews = [];

        // Add enabled test view sequences
        if (this.config.tests.sct) {
            testViews.push(
                { name: views.sctExp, passing: "gated", metadata: {} },
                { name: views.sctMain, passing: "direct", metadata: {} },
                { name: views.sctEval, passing: "gated", metadata: { testType: "sct" } }
            );
        }
        if (this.config.tests.lst) {
            testViews.push(
                { name: views.lstExp, passing: "gated", metadata: {} },
                { name: views.lstMain, passing: "direct", metadata: {} },
                { name: views.lstEval, passing: "gated", metadata: { testType: "lst" } }
            );
        }

        // Mark loop boundaries across enabled tests
        if (testViews.length > 0) {
            testViews[0].metadata = { ...testViews[0].metadata, loopBehaviour: "start" };

            const loopEndView = [...testViews].reverse().find((v) => v.metadata.testType);
            loopEndView.metadata = { ...loopEndView.metadata, loopBehaviour: "end" };
        }

        // Final view flow
        return [
            { name: views.waiting, passing: "direct", metadata: {} },
            { name: views.welcome, passing: "direct", metadata: {} },
            { name: views.pretest, passing: "gated", metadata: {} },
            ...testViews,
            ...(testViews.length > 0 ? [{ name: views.break, passing: "gated", metadata: { loopBehaviour: "break" } }] : []),
            { name: views.ending, passing: "direct", metadata: {} }
        ];
    }

    getNextView(currentView) {
        const viewIndex = this.viewFlow.findIndex((v) => v === currentView);

        // Repeat LST main view for the second role assignment
        if (currentView.name === views.lstEval && this.state.conditionListeningSpeakingTestIndex === 0) {
            return this.getViewByName(views.lstMain);
        }

        // Resolve loop-end navigation: Finish, break, or continue
        if (currentView.metadata.loopBehaviour === "end") {
            const roundsTotal = this.config.conditions.baseline.length + this.config.conditions.random.length;

            if (this.state.conditionIndex >= roundsTotal - 1) {
                return this.getViewByName(views.ending);
            }
            else if (this.state.conditionIndex + 1 === Math.floor(roundsTotal / 2)) {
                return this.getViewByMetadata("loopBehaviour", "break");
            }
            else {
                return this.getViewByMetadata("loopBehaviour", "start");
            }
        }

        // Resume the condition loop after a break
        if (currentView.metadata.loopBehaviour === "break") {
            return this.getViewByMetadata("loopBehaviour", "start");
        }

        // When nothing applies just continue with the next view
        return this.viewFlow[viewIndex + 1];
    }

    getViewByName(viewName) {
        return this.viewFlow.find((v) => v.name === viewName);
    }

    getViewByMetadata(key, value) {
        return this.viewFlow.find((v) => v.metadata[key] === value);
    }

    getViewData(view, client) {
        // Payload for pretest view
        if (view.name === views.pretest) {
            // prettier-ignore
            return {
                currentView: view.name,
                pretestForm: this.config.pretestForm
            };
        }

        // Payload for sctMain view
        if (view.name === views.sctMain) {
            // prettier-ignore
            return {
                currentView: view.name,
                conditionAsset: this.getClientConditionAsset(client)
            };
        }

        // Payload for lstMain and lstEval views
        if (view.name === views.lstMain || view.name === views.lstEval) {
            const isClientA = client.role === "a";
            const isFirstLstRound = this.state.conditionListeningSpeakingTestIndex === 0;
            const conditionListeningSpeakingTestRole = isClientA === isFirstLstRound ? "speaker" : "listener";

            let conditionAsset = null;

            if (conditionListeningSpeakingTestRole === "speaker") conditionAsset = this.getClientConditionAsset(client);
            else if (conditionListeningSpeakingTestRole === "listener") conditionAsset = "listener.png";

            // prettier-ignore
            return {
                currentView: view.name,
                conditionAsset,
                conditionListeningSpeakingTestIndex: this.state.conditionListeningSpeakingTestIndex,
                conditionListeningSpeakingTestRole
            };
        }

        return { currentView: view.name };
    }

    getClientConditionAsset(client) {
        const conditionPadded = padNumber(this.state.conditionIndex + 1, 2);
        if (!["a", "b"].includes(client.role)) throw new Error("Missing A/B role slot");
        return "client-" + client.role + "/" + conditionPadded + ".html";
    }
}

module.exports = { ViewFlow };
