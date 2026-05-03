import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Machine",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("name", models.CharField(max_length=20, unique=True)),
                (
                    "machine_type",
                    models.CharField(
                        choices=[
                            ("large_ac", "Large AC"),
                            ("small_ac", "Small AC"),
                            ("fan", "Fan"),
                        ],
                        max_length=20,
                    ),
                ),
                ("zone", models.CharField(max_length=100)),
                ("rated_power_kw", models.FloatField()),
                ("is_critical", models.BooleanField(default=False)),
            ],
            options={"db_table": "building_machine"},
        ),
        migrations.CreateModel(
            name="SensorReading",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("recorded_at", models.DateTimeField()),
                ("power_kw", models.FloatField()),
                ("temperature", models.FloatField(blank=True, null=True)),
                ("setpoint", models.FloatField(blank=True, null=True)),
                ("speed_pct", models.FloatField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("ON", "On"), ("OFF", "Off")],
                        max_length=3,
                    ),
                ),
                (
                    "machine",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="building.machine",
                    ),
                ),
            ],
            options={"db_table": "building_sensorreading"},
        ),
        migrations.CreateModel(
            name="AIDecision",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("decided_at", models.DateTimeField()),
                (
                    "action_type",
                    models.CharField(
                        choices=[
                            ("turn_on", "Turn On"),
                            ("turn_off", "Turn Off"),
                            ("set_temp", "Set Temp"),
                        ],
                        max_length=10,
                    ),
                ),
                ("value", models.FloatField(blank=True, null=True)),
                ("reason", models.TextField()),
                (
                    "machine",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="building.machine",
                    ),
                ),
            ],
            options={"db_table": "building_aidecision"},
        ),
    ]
