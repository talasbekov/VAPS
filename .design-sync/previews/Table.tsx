import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  Badge,
} from "my-v0-project";

export const EmployeeList = () => (
  <Table>
    <TableCaption>Личный состав Управления кадров на 3 июля</TableCaption>
    <TableHeader>
      <TableRow>
        <TableHead>ФИО</TableHead>
        <TableHead>Должность</TableHead>
        <TableHead>Подразделение</TableHead>
        <TableHead>Статус</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell className="font-medium">Ахметов Данияр Серикович</TableCell>
        <TableCell>Главный специалист</TableCell>
        <TableCell>Управление кадров</TableCell>
        <TableCell>
          <Badge className="bg-green-100 text-green-800">На месте</Badge>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Ибраева Алия Маратовна</TableCell>
        <TableCell>Начальник отдела</TableCell>
        <TableCell>Отдел учёта</TableCell>
        <TableCell>
          <Badge className="bg-blue-100 text-blue-800">В отпуске</Badge>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Сергеев Павел Андреевич</TableCell>
        <TableCell>Инспектор</TableCell>
        <TableCell>Отдел пропусков</TableCell>
        <TableCell>
          <Badge className="bg-yellow-100 text-yellow-800">На больничном</Badge>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Нуртазина Жанар Болатовна</TableCell>
        <TableCell>Специалист</TableCell>
        <TableCell>Канцелярия</TableCell>
        <TableCell>
          <Badge className="bg-purple-100 text-purple-800">Командировка</Badge>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Оспанов Ерлан Кайратович</TableCell>
        <TableCell>Ведущий специалист</TableCell>
        <TableCell>Управление кадров</TableCell>
        <TableCell>
          <Badge className="bg-red-100 text-red-800">Отсутствует</Badge>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
);

export const DepartmentSummary = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Подразделение</TableHead>
        <TableHead style={{ textAlign: "right" }}>По списку</TableHead>
        <TableHead style={{ textAlign: "right" }}>На месте</TableHead>
        <TableHead style={{ textAlign: "right" }}>Отсутствуют</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell className="font-medium">Управление кадров</TableCell>
        <TableCell style={{ textAlign: "right" }}>128</TableCell>
        <TableCell style={{ textAlign: "right" }}>117</TableCell>
        <TableCell style={{ textAlign: "right" }}>11</TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Отдел учёта</TableCell>
        <TableCell style={{ textAlign: "right" }}>96</TableCell>
        <TableCell style={{ textAlign: "right" }}>88</TableCell>
        <TableCell style={{ textAlign: "right" }}>8</TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Отдел пропусков</TableCell>
        <TableCell style={{ textAlign: "right" }}>112</TableCell>
        <TableCell style={{ textAlign: "right" }}>101</TableCell>
        <TableCell style={{ textAlign: "right" }}>11</TableCell>
      </TableRow>
      <TableRow>
        <TableCell className="font-medium">Канцелярия</TableCell>
        <TableCell style={{ textAlign: "right" }}>76</TableCell>
        <TableCell style={{ textAlign: "right" }}>65</TableCell>
        <TableCell style={{ textAlign: "right" }}>11</TableCell>
      </TableRow>
    </TableBody>
    <TableFooter>
      <TableRow>
        <TableCell>Итого</TableCell>
        <TableCell style={{ textAlign: "right" }}>412</TableCell>
        <TableCell style={{ textAlign: "right" }}>371</TableCell>
        <TableCell style={{ textAlign: "right" }}>41</TableCell>
      </TableRow>
    </TableFooter>
  </Table>
);
