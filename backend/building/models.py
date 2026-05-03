from django.db import models


class Machine(models.Model):
    LARGE_AC = "large_ac"
    SMALL_AC = "small_ac"
    FAN = "fan"
    MACHINE_TYPE_CHOICES = [
        (LARGE_AC, "Large AC"),
        (SMALL_AC, "Small AC"),
        (FAN, "Fan"),
    ]

    name = models.CharField(max_length=20, unique=True)
    machine_type = models.CharField(max_length=20, choices=MACHINE_TYPE_CHOICES)
    zone = models.CharField(max_length=100)
    rated_power_kw = models.FloatField()
    is_critical = models.BooleanField(default=False)

    class Meta:
        db_table = "building_machine"

    def __str__(self):
        return self.name


class SensorReading(models.Model):
    ON = "ON"
    OFF = "OFF"
    STATUS_CHOICES = [(ON, "On"), (OFF, "Off")]

    machine = models.ForeignKey(Machine, on_delete=models.CASCADE)
    recorded_at = models.DateTimeField()
    power_kw = models.FloatField()
    temperature = models.FloatField(null=True, blank=True)
    setpoint = models.FloatField(null=True, blank=True)
    speed_pct = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=3, choices=STATUS_CHOICES)

    class Meta:
        db_table = "building_sensorreading"


class AIDecision(models.Model):
    TURN_ON = "turn_on"
    TURN_OFF = "turn_off"
    SET_TEMP = "set_temp"
    ACTION_TYPE_CHOICES = [
        (TURN_ON, "Turn On"),
        (TURN_OFF, "Turn Off"),
        (SET_TEMP, "Set Temp"),
    ]

    decided_at = models.DateTimeField()
    machine = models.ForeignKey(
        Machine,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    action_type = models.CharField(max_length=10, choices=ACTION_TYPE_CHOICES)
    value = models.FloatField(null=True, blank=True)
    reason = models.TextField()

    class Meta:
        db_table = "building_aidecision"
