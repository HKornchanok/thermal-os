from django.urls import path

from .views import list_machines, machine_sensors, summary

urlpatterns = [
    path("machines/", list_machines, name="machines_list"),
    path("machines/<int:machine_id>/sensors/", machine_sensors, name="machine_sensors"),
    path("building/summary/", summary, name="building_summary"),
]
