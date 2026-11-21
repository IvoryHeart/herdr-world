import { coarseCoordinates, type Coordinates } from "../../../shared/weather";
/** Called only by the explicit button: never query permissions or watch location. */
export function browserWeatherLocation(
  geolocation: Geolocation | undefined = navigator.geolocation,
): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(
        new Error(
          "Browser location is unavailable. Type a city or coordinates.",
        ),
      );
      return;
    }
    geolocation.getCurrentPosition(
      (position) =>
        resolve(
          coarseCoordinates({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        ),
      () =>
        reject(
          new Error(
            "Browser location was not shared. Type a city or coordinates.",
          ),
        ),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
    );
  });
}
