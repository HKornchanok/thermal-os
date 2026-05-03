from django.contrib import admin

from .models import AIDecision, Machine, SensorReading


@admin.register(Machine)
class MachineAdmin(admin.ModelAdmin):
    list_display = ("name", "machine_type", "zone", "rated_power_kw", "is_critical")
    list_filter = ("machine_type", "is_critical")
    search_fields = ("name", "zone")


@admin.register(SensorReading)
class SensorReadingAdmin(admin.ModelAdmin):
    list_display = ("machine", "recorded_at", "status", "power_kw", "temperature")
    list_filter = ("status", "machine")
    date_hierarchy = "recorded_at"


@admin.register(AIDecision)
class AIDecisionAdmin(admin.ModelAdmin):
    list_display = ("decided_at", "machine", "action_type", "value")
    list_filter = ("action_type",)
    date_hierarchy = "decided_at"
