const unit=value=>Number.isFinite(Number(value))?Math.max(0,Math.min(1,Number(value))):0;

export function eyelidMix(blink,follow){
  blink=unit(blink);follow=unit(follow);
  // Both targets close the same lid: interpolate toward the validated closed
  // pose (blink=1, follow<=.07), rather than stacking two full closures.
  return {blink,follow:follow*(1-blink)+Math.min(follow,.07)*blink};
}
