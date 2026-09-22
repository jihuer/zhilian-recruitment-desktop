import {expect,test} from 'bun:test';
import {withMessageDirections} from '../desktop/message-direction';
const message={id:'m',at:'',text:'例文',kind:'text',senderId:'self'};
test('uses verified staff and peer identifiers, keeps unmatched senders unknown',()=>{
 expect(withMessageDirections([message,{...message,id:'2',senderId:'peer'},{...message,id:'3',senderId:'other'}],'self','peer').map(m=>m.direction)).toEqual(['outgoing','incoming','unknown']);
 expect(withMessageDirections([{...message,senderId:'peer'}],'self',undefined)[0]?.direction).toBe('unknown');
 expect(withMessageDirections([message],'self','self')[0]?.direction).toBe('unknown');
});
