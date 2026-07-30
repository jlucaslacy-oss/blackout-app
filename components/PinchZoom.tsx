import { ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";

interface Props {
  children: ReactNode;
  style?: object | object[];
  // Lets parents lock their pager/scroll while a pinch is active
  onZoomChange?: (zooming: boolean) => void;
}

// Instagram-style pinch: zoom follows the fingers' focal point, moving the
// fingers pans the zoomed photo, and everything eases back on release.
// One-shot zoom only — no persistent zoom state.
export default function PinchZoom({ children, style, onZoomChange }: Props) {
  const scale = useSharedValue(1);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const startFocalX = useSharedValue(0);
  const startFocalY = useSharedValue(0);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const zooming = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      zooming.value = 1;
      if (onZoomChange) runOnJS(onZoomChange)(true);
      startFocalX.value = e.focalX;
      startFocalY.value = e.focalY;
      focalX.value = e.focalX - w.value / 2;
      focalY.value = e.focalY - h.value / 2;
    })
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(e.scale, 1), 4);
      // Moving both fingers pans the zoomed photo
      panX.value = e.focalX - startFocalX.value;
      panY.value = e.focalY - startFocalY.value;
    })
    .onEnd(() => {
      scale.value = withTiming(1, { duration: 180 });
      panX.value = withTiming(0, { duration: 180 });
      panY.value = withTiming(0, { duration: 180 });
    })
    .onFinalize(() => {
      // Unconditional reset so an interrupted animation can't leave the
      // elevated zIndex (or a locked parent pager) stuck.
      zooming.value = withTiming(0, { duration: 200 });
      if (onZoomChange) runOnJS(onZoomChange)(false);
    });

  const animStyle = useAnimatedStyle(() => ({
    zIndex: zooming.value ? 20 : 0,
    transform: [
      { translateX: panX.value },
      { translateY: panY.value },
      { translateX: focalX.value },
      { translateY: focalY.value },
      { scale: scale.value },
      { translateX: -focalX.value },
      { translateY: -focalY.value },
    ],
  }));

  return (
    <GestureDetector gesture={pinch}>
      <Animated.View
        style={[style, animStyle]}
        onLayout={(e) => {
          w.value = e.nativeEvent.layout.width;
          h.value = e.nativeEvent.layout.height;
        }}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
