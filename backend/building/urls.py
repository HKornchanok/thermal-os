from django.urls import path

from .views import (
    decisions_list,
    energy,
    energy_by_zone,
    list_machines,
    machine_sensors,
    summary,
)

urlpatterns = [
    path("machines/", list_machines, name="machines_list"),
    path("machines/<int:machine_id>/sensors/", machine_sensors, name="machine_sensors"),
    path("building/summary/", summary, name="building_summary"),
    path("building/energy/", energy, name="building_energy"),
    path("building/energy/by-zone/", energy_by_zone, name="building_energy_by_zone"),
    path("decisions/", decisions_list, name="decisions_list"),
]
