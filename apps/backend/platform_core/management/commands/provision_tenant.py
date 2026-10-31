from getpass import getpass
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction
from platform_core.models import AuditEvent, Membership, Tenant


class Command(BaseCommand):
    help = "Provision a tenant and its administrator. Passwords are prompted, never command arguments."

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True)
        parser.add_argument("--slug", required=True)
        parser.add_argument("--username", required=True)

    def handle(self, *args, **options):
        tenant = Tenant(name=options["name"], slug=options["slug"])
        username = options["username"]
        user = get_user_model().objects.filter(username=username).first()
        try:
            tenant.full_clean()
            if user is None:
                user = get_user_model()(username=username)
                user.full_clean(exclude=["password"])
                password = getpass("New administrator password: ")
                if password != getpass("Confirm password: "):
                    raise CommandError("Passwords do not match.")
                validate_password(password, user)
                user.set_password(password)
            elif not user.is_active:
                raise CommandError("The selected user is inactive.")
            with transaction.atomic():
                user.save()
                tenant.save()
                member = Membership.objects.create(tenant=tenant, user=user, role=Membership.Role.ADMIN)
                AuditEvent.objects.create(tenant=tenant, actor=user, action="tenant.provisioned", target_id=str(member.pk))
        except (ValidationError, IntegrityError) as exc:
            raise CommandError("Invalid tenant or administrator; no provisioning changes were committed.") from exc
        self.stdout.write(self.style.SUCCESS(f"Tenant provisioned: {tenant.slug} ({tenant.pk})"))
