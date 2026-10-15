import Camera from "@arcgis/core/Camera";

/**
 * Oblique camera looking at a point from `distance` metres away, facing `heading`.
 * The defaults frame a 3D station column and its surroundings.
 */
export function cameraAt(longitude: number, latitude: number, distance = 4200, tilt = 58, heading = 0): Camera {
  const back = distance * Math.sin((tilt * Math.PI) / 180);
  const rad = (heading * Math.PI) / 180;
  const metresPerDegLat = 111_320;
  const metresPerDegLon = metresPerDegLat * Math.cos((latitude * Math.PI) / 180);
  return new Camera({
    position: {
      longitude: longitude - (back * Math.sin(rad)) / metresPerDegLon,
      latitude: latitude - (back * Math.cos(rad)) / metresPerDegLat,
      z: distance * Math.cos((tilt * Math.PI) / 180),
    },
    heading,
    tilt,
  });
}
