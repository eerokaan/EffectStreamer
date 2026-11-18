import {it,expect,afterEach} from 'vitest';
import {connectRuntimeStores} from '../../est-gui/src/renderer/windowMain/runtime/store-gateway.js';
import useStoreRoot from '../../est-gui/src/renderer/windowMain/stores/root.js';
afterEach(()=>useStoreRoot.getState().resetStates());
function connect(){let accept;connectRuntimeStores({subscribeConfiguration:()=>()=>{},subscribe:listener=>{accept=listener;return()=>{};}});return accept;}
const snapshot={revision:1,participantId:'person-a',sessionId:'session-a',attemptId:'attempt-a',currentView:'viewListeningSpeakingTestMain',setupComplete:true,viewData:{showDialog:true,conditionListeningSpeakingTestIndex:0}};
it('receipt snapshots cannot reopen a partner notice the participant already dismissed',()=>{
    const accept=connect();accept(snapshot);expect(useStoreRoot.getState().showDialog).toBe(true);
    useStoreRoot.getState().setShowDialog(false);accept({...snapshot,revision:2});
    expect(useStoreRoot.getState().showDialog).toBe(false);
});
it('changing views clears a prior partner notice and a later round can notify again',()=>{
    const accept=connect();accept(snapshot);
    accept({...snapshot,revision:2,currentView:'viewListeningSpeakingTestEvaluation',viewData:{conditionListeningSpeakingTestIndex:0}});
    expect(useStoreRoot.getState().showDialog).toBe(false);
    accept({...snapshot,revision:3,attemptId:'attempt-b',viewData:{conditionListeningSpeakingTestIndex:1}});
    expect(useStoreRoot.getState().showDialog).toBe(false);
    accept({...snapshot,revision:4,attemptId:'attempt-b',viewData:{showDialog:true,conditionListeningSpeakingTestIndex:1}});
    expect(useStoreRoot.getState().showDialog).toBe(true);
});
