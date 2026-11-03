using Microsoft.EntityFrameworkCore;

namespace SESMT.Infrastructure.Persistence.Queries;

public static class OperationalPermissionScope
{
    public static Task<bool> HasAsync(SesmtDbContext db, Guid actor, Guid company, string resource, string action, CancellationToken ct) =>
        (from assignment in db.UserRoles
         join role in db.Roles on assignment.RoleId equals role.Id
         join link in db.RolePermissions on role.Id equals link.RoleId
         join permission in db.Permissions on link.PermissionId equals permission.Id
         join user in db.Users on assignment.UserId equals user.Id
         where assignment.UserId == actor && (assignment.CompanyId == company || assignment.CompanyId == null)
             && assignment.Active && assignment.DeletedAt == null && role.Active && role.DeletedAt == null
             && link.Active && link.DeletedAt == null && permission.Active && permission.DeletedAt == null
             && user.Active && user.DeletedAt == null && permission.Resource == resource && permission.Action == action
         select permission.Id).AnyAsync(ct);
}
