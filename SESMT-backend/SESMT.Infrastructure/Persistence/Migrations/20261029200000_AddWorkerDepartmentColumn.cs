using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace SESMT.Infrastructure.Persistence.Migrations;

// DepartmentId was already in the EF snapshot but was absent from the initial database migration.
// Repair existing databases without guessing a department for historical workers.
[DbContext(typeof(SesmtDbContext))]
[Migration("20261029200000_AddWorkerDepartmentColumn")]
public sealed class AddWorkerDepartmentColumn : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        ALTER TABLE core.trabalhador ADD COLUMN IF NOT EXISTS setor_id uuid NULL;
        """);

    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.DropColumn(
        name: "setor_id", schema: "core", table: "trabalhador");
}
