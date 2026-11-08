# Each vehicle's glb, driverScale and clip, as in src/config.ts CARS and its *_RIDE (keep in step when a car is added
# or its ride changes). The other scripts load this file with exec, so it holds only the table.
CARS = {
    'f1': ('f1.glb', 0.4, 'Drive'), 'racer': ('racer.glb', 0.4, 'Drive'), 'corsa': ('stradale.glb', 0.4, 'Drive'),
    'barchetta': ('barchetta.glb', 0.4, 'Drive'), 'cuneo': ('cuneo.glb', 0.3, 'Drive'), 'vortex': ('vortex.glb', 0.3, 'Drive'),
    'senna': ('senna.glb', 0.4, 'Drive'), 'pony': ('pony.glb', 0.4, 'Drive'), 'scout': ('scout.glb', 0.5, 'Drive'),
    'hunter': ('humvee.glb', 1.3, 'Gunner'), 'titan': ('titan.glb', 0.8, 'Gunner'),
    'moto': ('moto.glb', 0.98, 'Moto'), 'cruiser': ('cruiser.glb', 1.1, 'Cruiser'),
    'enduro': ('enduro.glb', 0.98, 'Dirt'), 'mantis': ('mantis.glb', 0.98, 'Quad'),
}
MODELS = r"C:\inetpub\wwwroot\test\race\models"
