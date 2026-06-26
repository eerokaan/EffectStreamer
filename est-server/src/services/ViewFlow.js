const { views } = require("../views.js");

class ViewFlow {
    constructor({ state, estConfig, testEnabled, pretestFormConfig, clientRegistry }) {
        this.state = state;
        this.estConfig = estConfig;
        this.testEnabled = testEnabled;
        this.pretestFormConfig = pretestFormConfig;
        this.clientRegistry = clientRegistry;
        this.viewFlow = this.buildViewFlow();
    }

    // prettier-ignore
    buildViewFlow() {
        const testViews = [];

        if (this.testEnabled.sct) {
            testViews.push(
                { name: views.sctExp, passing: "gated", metadata: {} },
                { name: views.sctMain, passing: "direct", metadata: {} },
                { name: views.sctEval, passing: "gated", metadata: { testType: "sct" } }
            );
        }
        if (this.testEnabled.lst) {
            testViews.push(
                { name: views.lstExp, passing: "gated", metadata: {} },
                { name: views.lstMain, passing: "direct", metadata: {} },
                { name: views.lstEval, passing: "gated", metadata: { testType: "lst" } }
            );
        }
        if (testViews.length > 0) {
            testViews[0].metadata = { ...testViews[0].metadata, loopBehaviour: "start" };
            
            const loopEndView = [...testViews].reverse().find((view) => view.metadata?.testType);
            loopEndView.metadata = { ...loopEndView.metadata, loopBehaviour: "end" };
        }

        return [
            { name: views.waiting, passing: "direct", metadata: {} },
            { name: views.welcome, passing: "direct", metadata: {} },
            { name: views.pretest, passing: "gated", metadata: {} },
            ...testViews,
            ...(testViews.length > 0 ? [{ name: views.break, passing: "gated", metadata: { loopBehaviour: "break" } }] : []),
            { name: views.ending, passing: "direct", metadata: {} }];
    }

    getNextView(currentView) {
        const viewIndex = this.viewFlow.findIndex((view) => view.name === currentView);
        const view = this.viewFlow[viewIndex];

        if (currentView === views.lstEval && this.state.conditionListeningSpeakingTestIndex === 0) {
            return views.lstMain;
        }

        // When current view indicates a loop end: Either exit (viewEnding), show break (viewBreak) or loop back
        if (view.metadata?.loopBehaviour === "end") {
            const roundsTotal = this.estConfig.conditions.baseline.length + this.estConfig.conditions.random.length;

            if (this.state.conditionIndex >= roundsTotal - 1) {
                return views.ending;
            }
            else if (this.state.conditionIndex + 1 === Math.floor(roundsTotal / 2)) {
                return this.viewFlow.find((view) => view.metadata?.loopBehaviour === "break").name;
            }
            else {
                return this.viewFlow.find((view) => view.metadata?.loopBehaviour === "start").name;
            }
        }

        // When current view indicates a break: Resume to the loop
        if (view.metadata?.loopBehaviour === "break") {
            return this.viewFlow.find((view) => view.metadata?.loopBehaviour === "start").name;
        }

        // When nothing applies, just continue with the next view
        return this.viewFlow[viewIndex + 1].name;
    }

    getViewData(viewName, clientSocketId) {
        if (viewName === views.pretest) {
            return { currentView: viewName, pretestForm: this.pretestFormConfig };
        }

        const isSct = viewName === views.sctMain;
        const isLst = viewName === views.lstMain;
        const isLstEvaluation = viewName === views.lstEval;

        if (isSct || isLst || isLstEvaluation) {
            const client = this.clientRegistry.getBySocketId(clientSocketId);
            if (!client) return { currentView: viewName };

            const clientNumber = client.clientIndex === 0 ? "01" : "02";
            const conditionPadded = String(this.state.conditionIndex + 1).padStart(2, "0");
            const clientConditionAsset = "client_" + clientNumber + "/" + conditionPadded + ".png";

            let conditionListeningSpeakingTestRole = null;
            if (isLst || isLstEvaluation) {
                if (this.state.conditionListeningSpeakingTestIndex === 0) {
                    conditionListeningSpeakingTestRole = client.clientIndex === 0 ? "speaker" : "listener";
                }
                else {
                    conditionListeningSpeakingTestRole = client.clientIndex === 0 ? "listener" : "speaker";
                }
            }

            let conditionAsset = null;

            if (isSct) {
                conditionAsset = clientConditionAsset;
            }
            else if (isLst) {
                conditionAsset = conditionListeningSpeakingTestRole === "speaker" ? clientConditionAsset : "listener.png";
            }

            const response = {
                currentView: viewName,
                conditionAsset: conditionAsset
            };

            if (isLst || isLstEvaluation) {
                response.conditionListeningSpeakingTestIndex = this.state.conditionListeningSpeakingTestIndex;
                response.conditionListeningSpeakingTestRole = conditionListeningSpeakingTestRole;
            }

            return response;
        }

        return { currentView: viewName };
    }
}

module.exports = { ViewFlow };
