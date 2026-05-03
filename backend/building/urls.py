from django.urls import path

from .views import list_machines

urlpatterns = [
    path("machines/", list_machines, name="machines_list"),
]
