using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HotelManagementAPI.Migrations
{
    /// <inheritdoc />
    public partial class PreserveServiceUsageName : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ServiceName",
                table: "ServiceUsages",
                type: "TEXT",
                maxLength: 100,
                nullable: false,
                defaultValue: "");
            // Prefer the original operation snapshot. Older usages without one can only
            // retain the catalog name available at upgrade; never rewrite issued invoices.
            migrationBuilder.Sql("""
                UPDATE ServiceUsages SET ServiceName = COALESCE(
                    (SELECT ServiceName FROM ServiceUsageOperations WHERE UsageId = ServiceUsages.Id),
                    (SELECT Name FROM Services WHERE Id = ServiceUsages.ServiceId),
                    'Dịch vụ');
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ServiceName",
                table: "ServiceUsages");
        }
    }
}
