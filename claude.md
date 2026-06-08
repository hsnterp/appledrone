Use relative position from Mission Pad, 

Use current Roboflow detector to find fruit candidates → track/deduplicate fruit across overlapping photos using geometry + visual matching and then → send only unique count and pictures of said fruit crops to a Open API token.

Use Distance formula to determine distance from the drone to every fruit tracked. Focal length is distance_cm = (1850 * 6.5) / fruit_diameter_pixles(based off stage of ripeness (need to search this up) for the fruit detected)

Use Webgl to create a map of said fruits and corresponding fruit Tree.

