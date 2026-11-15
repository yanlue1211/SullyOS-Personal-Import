// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {shareOrDownloadBlob} from './shareExport';
it('missing Android filename hook does not block blob download and shim is removed',async()=>{
 const bridge={};(window as any).Android=bridge;
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()}));
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this: HTMLAnchorElement){(window as any).Android.captureDownloadName(this.download);});
 try{await expect(shareOrDownloadBlob({blob:new Blob(['audio'],{type:'audio/mpeg'}),fileName:'song.mp3',preferDownloadOnWeb:true})).resolves.toBe('downloaded');expect(click).toHaveBeenCalledOnce();expect('captureDownloadName' in bridge).toBe(false);}finally{click.mockRestore();delete (window as any).Android;vi.unstubAllGlobals();}
});
