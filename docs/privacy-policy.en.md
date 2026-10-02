# Tokyojihatsu Privacy Policy

Last updated: 2026-10-03

Tokyojihatsu is an app for Even Realities G2 that shows how long remains until the
next train, based on published station timetables. This policy explains what the
app handles and how.

## Permissions the app requests

The app requests exactly two permissions.

### Location

**Purpose**: Only to list nearby stations as candidates, so you do not have to
type a station name.

**Handling**: Your location is **processed entirely on your phone and is never
transmitted anywhere**. Nearby stations are determined by comparing your position
against a list of station coordinates bundled inside the app. Neither the
developer nor anyone else receives your location.

If you deny location access, nearby stations cannot be listed automatically, but
the rest of the app still works.

### Motion sensor (IMU)

**Purpose**: to support the look-up display, the app reads head tilt from the
IMU (accelerometer) in the smart glasses. The readings are used only to decide,
at that moment, whether you are looking up or down. **They are never stored or
transmitted.**

The sensor is enabled when the app starts and **always disabled when it exits**.
If you switch to always-on display, the sensor remains enabled; only the
look-up decision is skipped.

It is never used to track movement, analyse posture, or infer activity.

### Network

**Purpose**: Only to fetch station timetables.

**Destination**: The app connects solely to a relay server operated by the
developer at
`https://7i3fsrat6n32v4fadbful24jsm0yrbyu.lambda-url.ap-northeast-1.on.aws`
(Amazon Web Services, Tokyo region). The relay fetches timetables from the Open
Data Center for Public Transportation (ODPT) and returns them.

**What is sent**: Only an identifier indicating which station and direction the
timetable is for. **No location data and no personally identifying information is
sent.**

## Data stored on your device

Two things are stored on your device. **Neither ever leaves it.** Both are removed
when you uninstall the app.

- The most recently selected station and direction, so the app can resume
  immediately next time
- **The coordinates recorded at that moment**, used only to decide whether the
  previous station is still the sensible choice when you start the app in the
  same place

The coordinates are used for that decision on the device alone. They are never
transmitted or logged.

## Relay server logs

The relay server retains operational logs (timestamps and error details) for at
most 7 days for troubleshooting, after which they are deleted automatically. The
logs contain no location data.

## Sharing with third parties

Information handled by this app is never sold or shared with third parties. The
app shows no advertising and uses no analytics.

## About the timetable data

Timetables and delay information shown by this app are provided by the Open Data
Center for Public Transportation. Their accuracy and completeness are not
guaranteed. Times shown are scheduled departure times; where an operator
publishes delay information, that delay is added. For operators that do not
publish it, only the scheduled time is shown.

Please do not contact transit operators directly about information shown in this
app. Use the contact address below instead.

## Contact

async.sync+tokyojihatsu@gmail.com

## Changes to this policy

If this policy changes, the last-updated date above will be revised.
