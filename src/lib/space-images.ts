// Generated for this fictional venue; provenance is recorded in ASSET_PROVENANCE.md.
export function spaceImage(kind:string,seats=1) {
  const name=kind==='room'?(seats===4?'cove':seats===6?'grove':'canopy'):kind==='quiet_desk'?'quiet-studio':'open-studio';
  return {src:`/spaces/${name}.webp`,alt:`Generated impression of an imagined ${kind==='room'?`${seats}-seat meeting room`:kind==='quiet_desk'?'quiet workspace':'open studio'}`};
}
